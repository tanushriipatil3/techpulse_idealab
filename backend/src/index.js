import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const E = process.env;
const db = new PrismaClient();
const app = express();

const PORT = E.BACKEND_PORT || 4000;
const APP_URL = E.APP_URL || 'http://localhost:3000';

app.use(express.json());
app.use(cookieParser());

// Robust CORS configuration
const allowedOrigins = [
  APP_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4000',
  'http://127.0.0.1:4000'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      callback(null, true);
    } else {
      callback(null, true); // Dev-friendly permissive origin
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Encryption helpers for GitHub tokens
const rawKey = E.TOKEN_ENC_KEY || 'techpulse-default-fallback-encryption-key-32-chars-long';
const key = crypto.createHash('sha256').update(rawKey).digest();

const enc = (text) => {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(x => x.toString('base64')).join('.');
};

const dec = (str) => {
  if (!str) return '';
  try {
    const parts = str.split('.');
    if (parts.length !== 3) return '';
    const [iv, tag, encrypted] = parts.map(x => Buffer.from(x, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (err) {
    console.warn('Token decryption warning:', err.message);
    return '';
  }
};

const ck = {
  httpOnly: true,
  sameSite: 'lax',
  secure: E.NODE_ENV === 'production',
  path: '/'
};

// GitHub API helper with timeout & rate limit awareness
const gh = async (path, token) => {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'TechPulse-Dashboard/1.0'
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch('https://api.github.com' + path, {
    headers,
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message = errBody.message || `GitHub error ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
};

// HTML entity decoder for Stack Overflow titles
const decodeEntities = (str) => {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&trade;/g, '™')
    .replace(/&copy;/g, '©');
};

// Async wrapper to capture errors cleanly
const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error('API Error:', err.message);
    res.status(err.status || 502).json({ error: err.message || 'Internal Server Error' });
  });
};

// Auth middleware
const auth = async (req, res, next) => {
  try {
    const sid = req.cookies.sid || (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));
    if (!sid) {
      return res.status(401).json({ error: 'not logged in' });
    }

    const session = await db.session.findUnique({
      where: { id: sid },
      include: { user: true }
    });

    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'session expired or invalid' });
    }

    req.user = session.user;
    req.token = dec(session.user.tokenEnc);
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(500).json({ error: 'Authentication check failed' });
  }
};

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
      services: {
        backend: 'ready',
        ai_url: E.AI_URL || 'http://localhost:8000'
      }
    });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'disconnected', error: err.message });
  }
});

// Demo login route (allows full testing even if GitHub OAuth credentials are not yet set)
app.post('/api/auth/demo', wrap(async (req, res) => {
  const demoGithubId = 99990001;
  const demoLogin = 'techpulse-dev';
  const demoAvatar = 'https://avatars.githubusercontent.com/u/9919?v=4';

  const user = await db.user.upsert({
    where: { githubId: demoGithubId },
    update: { login: demoLogin, avatar: demoAvatar, tokenEnc: enc('demo_token') },
    create: { githubId: demoGithubId, login: demoLogin, avatar: demoAvatar, tokenEnc: enc('demo_token') }
  });

  const sid = crypto.randomBytes(32).toString('hex');
  await db.session.create({
    data: {
      id: sid,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 864e5)
    }
  });

  res.cookie('sid', sid, { ...ck, maxAge: 7 * 864e5 });
  res.json({ ok: true, user: { login: user.login, avatar: user.avatar } });
}));

// GitHub OAuth entry point
app.get('/api/auth/github', (req, res) => {
  if (!E.GITHUB_CLIENT_ID) {
    // If GitHub OAuth isn't configured, redirect with informative message
    return res.redirect(`${APP_URL}?auth_error=GitHub+OAuth+is+not+configured+in+.env.+You+can+use+Demo+Mode+to+test.`);
  }

  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, { ...ck, maxAge: 600000 });

  const redirectUri = `${APP_URL}/api/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: E.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read:user',
    state
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GitHub OAuth callback
app.get('/api/auth/github/callback', wrap(async (req, res) => {
  const { code, state } = req.query;
  if (!state || state !== req.cookies.oauth_state) {
    return res.status(400).send('Invalid OAuth state. Please try logging in again.');
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: E.GITHUB_CLIENT_ID,
      client_secret: E.GITHUB_CLIENT_SECRET,
      code
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return res.status(400).send(`GitHub token exchange failed: ${tokenData.error_description || 'unknown error'}`);
  }

  const ghUser = await gh('/user', tokenData.access_token);

  const user = await db.user.upsert({
    where: { githubId: ghUser.id },
    update: {
      login: ghUser.login,
      avatar: ghUser.avatar_url,
      tokenEnc: enc(tokenData.access_token)
    },
    create: {
      githubId: ghUser.id,
      login: ghUser.login,
      avatar: ghUser.avatar_url,
      tokenEnc: enc(tokenData.access_token)
    }
  });

  const sid = crypto.randomBytes(32).toString('hex');
  await db.session.create({
    data: {
      id: sid,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 864e5)
    }
  });

  res.clearCookie('oauth_state');
  res.cookie('sid', sid, { ...ck, maxAge: 7 * 864e5 });
  res.redirect(APP_URL);
}));

// Logout
app.post('/api/auth/logout', async (req, res) => {
  if (req.cookies.sid) {
    await db.session.deleteMany({ where: { id: req.cookies.sid } }).catch(() => {});
  }
  res.clearCookie('sid');
  res.json({ ok: true });
});

// Current User Profile
app.get('/api/me', auth, (req, res) => {
  res.json({
    id: req.user.id,
    login: req.user.login,
    avatar: req.user.avatar,
    isDemo: req.user.githubId === 99990001
  });
});

// User Repositories & Stats
app.get('/api/repos', auth, wrap(async (req, res) => {
  // Demo mode sample fallback if demo user
  if (req.user.githubId === 99990001 || req.token === 'demo_token') {
    return res.json({
      total: 18,
      stars: 142,
      forks: 38,
      languages: [
        { name: 'TypeScript', count: 7 },
        { name: 'Python', count: 4 },
        { name: 'JavaScript', count: 3 },
        { name: 'Go', count: 2 },
        { name: 'Rust', count: 1 },
        { name: 'HTML', count: 1 }
      ],
      repositories: [
        { name: 'techpulse-dashboard', stars: 45, forks: 12, language: 'TypeScript', description: 'Real-time developer intelligence feed and activity metrics' },
        { name: 'fastapi-gemini-agent', stars: 34, forks: 8, language: 'Python', description: 'Lightweight AI microservice using Google Gemini 1.5 Flash' },
        { name: 'react-chart-toolkit', stars: 29, forks: 7, language: 'JavaScript', description: 'Modern responsive charting primitives for Next.js applications' },
        { name: 'distributed-crawler', stars: 18, forks: 5, language: 'Go', description: 'High-throughput concurrency pipeline for news aggregation' },
        { name: 'secure-token-vault', stars: 16, forks: 6, language: 'Rust', description: 'AES-256-GCM cryptographic secret manager' }
      ]
    });
  }

  try {
    let repos = [];
    for (let p = 1; p <= 3; p++) {
      const r = await gh(`/user/repos?per_page=100&page=${p}&sort=pushed&affiliation=owner`, req.token);
      if (Array.isArray(r)) {
        repos = repos.concat(r);
        if (r.length < 100) break;
      } else {
        break;
      }
    }

    const langs = {};
    repos.forEach(r => {
      if (r.language) {
        langs[r.language] = (langs[r.language] || 0) + 1;
      }
    });

    res.json({
      total: repos.length,
      stars: repos.reduce((a, r) => a + (r.stargazers_count || 0), 0),
      forks: repos.reduce((a, r) => a + (r.forks_count || 0), 0),
      languages: Object.entries(langs)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      repositories: repos.slice(0, 10).map(r => ({
        name: r.name,
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language,
        description: r.description,
        url: r.html_url
      }))
    });
  } catch (err) {
    if (err.status === 403 || err.status === 429) {
      return res.status(429).json({ error: 'GitHub API rate limit reached. Please wait a few moments.' });
    }
    throw err;
  }
}));

// Commit Activity Feed
app.get('/api/activity', auth, wrap(async (req, res) => {
  // Demo mode sample fallback
  if (req.user.githubId === 99990001 || req.token === 'demo_token') {
    const days = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 864e5);
      const dateStr = d.toISOString().slice(0, 10);
      const baseCommits = [3, 5, 2, 8, 4, 0, 1, 6, 7, 3, 9, 5, 2, 6];
      days.push({ date: dateStr, commits: baseCommits[13 - i] });
    }
    return res.json(days);
  }

  try {
    const ev = await gh(`/users/${req.user.login}/events?per_page=100`, req.token);
    const days = {};
    if (Array.isArray(ev)) {
      ev.filter(e => e.type === 'PushEvent').forEach(e => {
        const d = e.created_at.slice(0, 10);
        days[d] = (days[d] || 0) + (e.payload?.size || e.payload?.commits?.length || 1);
      });
    }

    const activityList = Object.entries(days)
      .map(([date, commits]) => ({ date, commits }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(activityList);
  } catch (err) {
    if (err.status === 403 || err.status === 429) {
      return res.status(429).json({ error: 'GitHub rate limit exceeded for activity.' });
    }
    throw err;
  }
}));

// Trending Repositories
app.get('/api/trending', auth, wrap(async (req, res) => {
  const language = req.query.language ? `+language:${encodeURIComponent(req.query.language)}` : '';
  const daysAgo = parseInt(req.query.days) || 7;
  const since = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

  try {
    const r = await gh(`/search/repositories?q=created:>${since}${language}&sort=stars&order=desc&per_page=15`, req.token);
    if (!r.items) {
      return res.json([]);
    }
    res.json(r.items.map(i => ({
      name: i.full_name,
      url: i.html_url,
      stars: i.stargazers_count,
      forks: i.forks_count,
      description: i.description || 'No description provided.',
      language: i.language || 'Code',
      topics: i.topics || []
    })));
  } catch (err) {
    console.warn('Trending search error, using fallback:', err.message);
    // Graceful fallback to prominent open source projects if rate limited
    res.json([
      { name: 'shadcn/ui', url: 'https://github.com/shadcn-ui/ui', stars: 74200, forks: 6200, description: 'Beautifully designed components that you can copy and paste into your apps.', language: 'TypeScript' },
      { name: 'vllm-project/vllm', url: 'https://github.com/vllm-project/vllm', stars: 36500, forks: 4800, description: 'A high-throughput and memory-efficient LLM serving engine.', language: 'Python' },
      { name: 'astral-sh/uv', url: 'https://github.com/astral-sh/uv', stars: 39800, forks: 1500, description: 'An extremely fast Python package and project manager, written in Rust.', language: 'Rust' },
      { name: 'fastapi/fastapi', url: 'https://github.com/fastapi/fastapi', stars: 81200, forks: 6900, description: 'FastAPI framework, high performance, easy to learn, fast to code, ready for production', language: 'Python' }
    ]);
  }
}));

// Aggregated Developer News & Discussions Feed
let cache = { t: 0, v: null };

app.get('/api/news', auth, async (req, res) => {
  // 10 minute cache if valid items exist
  if (cache.v && cache.v.items && cache.v.items.length > 0 && Date.now() - cache.t < 600000) {
    return res.json(cache.v);
  }

  // 1. Hacker News Top Stories
  const hn = async () => {
    const topIdsRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(5000) });
    if (!topIdsRes.ok) throw new Error(`HN status ${topIdsRes.status}`);
    const ids = (await topIdsRes.json()).slice(0, 10);
    const itemPromises = ids.map(id =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(4000) })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    );
    const items = (await Promise.all(itemPromises)).filter(Boolean);
    return items.map(x => ({
      title: x.title,
      url: x.url || `https://news.ycombinator.com/item?id=${x.id}`,
      source: 'Hacker News',
      score: x.score || 0,
      author: x.by || 'anonymous',
      comments: x.descendants || 0,
      time: x.time ? new Date(x.time * 1000).toISOString() : new Date().toISOString()
    }));
  };

  // 2. Dev.to Tech Feed (Free, highly reliable developer articles)
  const devTo = async () => {
    const r = await fetch('https://dev.to/api/articles?per_page=10&top=7', {
      headers: { 'User-Agent': 'TechPulse-Dashboard/1.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) throw new Error(`Dev.to status ${r.status}`);
    const articles = await r.json();
    return articles.map(a => ({
      title: a.title,
      url: a.url,
      source: 'Dev.to',
      snippet: a.description,
      score: a.positive_reactions_count || 0,
      author: a.user?.name || a.user?.username || 'Dev',
      tags: a.tag_list || [],
      time: a.published_at || new Date().toISOString()
    }));
  };

  // 3. Stack Overflow Hot Questions
  const se = async () => {
    const keyParam = E.STACK_KEY ? `&key=${encodeURIComponent(E.STACK_KEY)}` : '';
    const r = await fetch(`https://api.stackexchange.com/2.3/questions?order=desc&sort=hot&site=stackoverflow&pagesize=8${keyParam}`, {
      headers: { 'Accept-Encoding': 'gzip' },
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) throw new Error(`StackExchange status ${r.status}`);
    const data = await r.json();
    if (!data.items) throw new Error('Invalid StackExchange response structure');
    return data.items.map(x => ({
      title: decodeEntities(x.title),
      url: x.link,
      source: 'Stack Overflow',
      score: x.score || 0,
      author: x.owner?.display_name || 'developer',
      tags: x.tags || [],
      time: x.creation_date ? new Date(x.creation_date * 1000).toISOString() : new Date().toISOString()
    }));
  };

  // 4. NewsAPI (Optional)
  const na = async () => {
    if (!E.NEWS_API_KEY) throw new Error('Not configured (optional)');
    const r = await fetch(`https://newsapi.org/v2/top-headlines?category=technology&language=en&pageSize=8`, {
      headers: { 'X-Api-Key': E.NEWS_API_KEY },
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) throw new Error(`NewsAPI status ${r.status}`);
    const data = await r.json();
    if (!data.articles) throw new Error(data.message || 'NewsAPI error');
    return data.articles.map(x => ({
      title: x.title,
      url: x.url,
      source: 'NewsAPI',
      snippet: x.description,
      author: x.author || x.source?.name || 'Tech News',
      time: x.publishedAt || new Date().toISOString()
    }));
  };

  const results = await Promise.allSettled([hn(), devTo(), se(), na()]);
  const sourceNames = ['Hacker News', 'Dev.to', 'Stack Overflow', 'NewsAPI'];
  const status = {};
  const allItems = [];

  results.forEach((resItem, idx) => {
    const name = sourceNames[idx];
    if (resItem.status === 'fulfilled') {
      status[name] = 'online';
      allItems.push(...resItem.value);
    } else {
      status[name] = resItem.reason?.message || 'unavailable';
    }
  });

  // Sort by time or score
  allItems.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  const responsePayload = {
    items: allItems,
    status,
    total: allItems.length,
    timestamp: new Date().toISOString()
  };

  if (allItems.length > 0) {
    cache = { t: Date.now(), v: responsePayload };
  }

  res.json(responsePayload);
});

// AI Summarization
app.post('/api/summarize', auth, wrap(async (req, res) => {
  const { title, url, snippet } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Article title is required for summarization.' });
  }

  const aiServiceUrl = (E.AI_URL || 'http://localhost:8000') + '/summarize';

  try {
    const aiRes = await fetch(aiServiceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, url: url || '', snippet: snippet || '' }),
      signal: AbortSignal.timeout(35000)
    });

    const aiData = await aiRes.json().catch(() => ({}));

    if (!aiRes.ok) {
      if (aiRes.status === 503) {
        return res.json({
          summary: snippet
            ? `Summary preview: ${snippet.slice(0, 220)}...`
            : `Discussion regarding "${title}". Highlights key software engineering patterns and implementation insights.`,
          ai_generated: false,
          fallback: true,
          model_used: 'Extractive Preview (Add GEMINI_API_KEY in .env for Gemini)'
        });
      }
      const errorMsg = aiData.detail || aiData.error || `AI microservice returned HTTP ${aiRes.status}`;
      return res.status(aiRes.status).json({ error: errorMsg });
    }

    res.json(aiData);
  } catch (err) {
    console.warn('AI service connection failed:', err.message);
    // Provide a smart preview fallback if AI service is not running or timed out
    res.json({
      summary: snippet
        ? `Key takeaway: ${snippet.slice(0, 180)}... Focuses on developer practices and implementation.`
        : `Discussion on "${title}". Focuses on software engineering techniques, architectural considerations, and community insights.`,
      ai_generated: false,
      fallback: true,
      note: 'AI microservice is offline or unreachable at ' + (E.AI_URL || 'http://localhost:8000')
    });
  }
}));

// Bookmarks
app.get('/api/bookmarks', auth, wrap(async (req, res) => {
  const bookmarks = await db.bookmark.findMany({
    where: { userId: req.user.id },
    orderBy: { id: 'desc' }
  });
  res.json(bookmarks);
}));

app.post('/api/bookmarks', auth, wrap(async (req, res) => {
  const { url, title, source } = req.body;
  if (!url || !title) {
    return res.status(400).json({ error: 'url and title are required' });
  }

  const bookmark = await db.bookmark.upsert({
    where: {
      userId_url: {
        userId: req.user.id,
        url: url.trim()
      }
    },
    update: {
      title: title.trim(),
      source: source || 'Web'
    },
    create: {
      userId: req.user.id,
      url: url.trim(),
      title: title.trim(),
      source: source || 'Web'
    }
  });

  res.json(bookmark);
}));

app.delete('/api/bookmarks/:id', auth, wrap(async (req, res) => {
  const bookmarkId = parseInt(req.params.id, 10);
  if (isNaN(bookmarkId)) {
    return res.status(400).json({ error: 'Invalid bookmark id' });
  }

  await db.bookmark.deleteMany({
    where: {
      id: bookmarkId,
      userId: req.user.id
    }
  });

  res.json({ ok: true });
}));

// Start Server
app.listen(PORT, () => {
  console.log(`[TechPulse Backend] API running on http://localhost:${PORT}`);
  console.log(`[TechPulse Backend] Connecting to UI at ${APP_URL}`);
});
