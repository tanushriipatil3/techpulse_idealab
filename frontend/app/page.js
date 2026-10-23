'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid
} from 'recharts';

// API Fetch Helper with error handling and credentials
async function api(path, options = {}) {
  const isPostOrPut = options.method === 'POST' || options.method === 'PUT';
  const headers = {
    ...(isPostOrPut ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };

  const res = await fetch('/api' + path, {
    ...options,
    headers,
    credentials: 'include'
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = data.error || data.detail || `Request failed with status ${res.status}`;
    throw new Error(errorMsg);
  }

  return data;
}

export default function Home() {
  const [me, setMe] = useState(undefined); // undefined = loading, null = unauth, object = logged in
  const [activeTab, setActiveTab] = useState('overview'); // overview, news, trending, repos, bookmarks
  const [data, setData] = useState({ repos: null, act: null, trend: null, news: null });
  const [bookmarks, setBookmarks] = useState([]);
  const [aiSummaries, setAiSummaries] = useState({});
  const [toasts, setToasts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  const [isDemoLoggingIn, setIsDemoLoggingIn] = useState(false);

  // Toast notification helper
  const addToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  // Check auth session on mount
  useEffect(() => {
    api('/me')
      .then((user) => setMe(user))
      .catch(() => setMe(null));
  }, []);

  // Load dashboard data when authenticated
  useEffect(() => {
    if (!me) return;

    // Load repositories
    api('/repos')
      .then((res) => setData((prev) => ({ ...prev, repos: res })))
      .catch((err) => setData((prev) => ({ ...prev, repos: { error: err.message } })));

    // Load commit activity
    api('/activity')
      .then((res) => setData((prev) => ({ ...prev, act: res })))
      .catch((err) => setData((prev) => ({ ...prev, act: { error: err.message } })));

    // Load trending repos
    api('/trending')
      .then((res) => setData((prev) => ({ ...prev, trend: res })))
      .catch((err) => setData((prev) => ({ ...prev, trend: { error: err.message } })));

    // Load aggregated news
    api('/news')
      .then((res) => setData((prev) => ({ ...prev, news: res })))
      .catch((err) => setData((prev) => ({ ...prev, news: { error: err.message } })));

    // Load user bookmarks
    api('/bookmarks')
      .then((res) => setBookmarks(Array.isArray(res) ? res : []))
      .catch(() => {});
  }, [me]);

  // Demo Login Handler
  const handleDemoLogin = async () => {
    setIsDemoLoggingIn(true);
    try {
      const res = await api('/auth/demo', { method: 'POST' });
      if (res.user) {
        setMe(res.user);
        addToast('Logged in as Demo Developer!', 'success');
      }
    } catch (err) {
      addToast('Demo login error: ' + err.message, 'error');
    } finally {
      setIsDemoLoggingIn(false);
    }
  };

  // Sign out handler
  const handleSignOut = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
      setMe(null);
      setData({ repos: null, act: null, trend: null, news: null });
      setBookmarks([]);
      addToast('Signed out successfully');
    } catch (err) {
      addToast('Sign out failed: ' + err.message, 'error');
    }
  };

  // AI Summarize handler
  const handleSummarize = async (item) => {
    const key = item.url;
    setAiSummaries((prev) => ({
      ...prev,
      [key]: { status: 'loading', text: 'Generating AI summary...' }
    }));

    try {
      const res = await api('/summarize', {
        method: 'POST',
        body: JSON.stringify({
          title: item.title,
          url: item.url,
          snippet: item.snippet || ''
        })
      });

      setAiSummaries((prev) => ({
        ...prev,
        [key]: {
          status: 'done',
          text: res.summary,
          fallback: res.fallback || false,
          model: res.model_used || 'Gemini 1.5 Flash'
        }
      }));
      addToast('AI Summary ready', 'success');
    } catch (err) {
      setAiSummaries((prev) => ({
        ...prev,
        [key]: { status: 'error', text: err.message }
      }));
      addToast('Summary error: ' + err.message, 'error');
    }
  };

  // Bookmark Toggle
  const handleToggleBookmark = async (item) => {
    const existing = bookmarks.find((b) => b.url === item.url);
    if (existing) {
      try {
        await api('/bookmarks/' + existing.id, { method: 'DELETE' });
        setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));
        addToast('Removed from bookmarks');
      } catch (err) {
        addToast('Failed to remove: ' + err.message, 'error');
      }
    } else {
      try {
        const saved = await api('/bookmarks', {
          method: 'POST',
          body: JSON.stringify({
            url: item.url,
            title: item.title || item.name,
            source: item.source || 'GitHub'
          })
        });
        setBookmarks((prev) => [saved, ...prev]);
        addToast('Saved to bookmarks!', 'success');
      } catch (err) {
        addToast('Failed to save bookmark: ' + err.message, 'error');
      }
    }
  };

  // Copy to clipboard
  const handleCopy = (text) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      addToast('Copied summary to clipboard!');
    }
  };

  // Filtered News Items
  const filteredNews = useMemo(() => {
    const items = data.news?.items || [];
    return items.filter((item) => {
      const matchesSource =
        sourceFilter === 'all' || item.source.toLowerCase() === sourceFilter.toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        (item.snippet && item.snippet.toLowerCase().includes(q)) ||
        (item.author && item.author.toLowerCase().includes(q));
      return matchesSource && matchesSearch;
    });
  }, [data.news, sourceFilter, searchQuery]);

  // Filtered Trending Repos
  const filteredTrending = useMemo(() => {
    const repos = Array.isArray(data.trend) ? data.trend : [];
    return repos.filter((r) => {
      const matchesLang =
        languageFilter === 'all' || (r.language && r.language.toLowerCase() === languageFilter.toLowerCase());
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q));
      return matchesLang && matchesSearch;
    });
  }, [data.trend, languageFilter, searchQuery]);

  // Loading State Indicator
  if (me === undefined) {
    return (
      <div className="hero-wrapper">
        <div style={{ textAlign: 'center' }}>
          <div className="brand-logo" style={{ margin: '0 auto 1.5rem', width: 48, height: 48 }}>⚡</div>
          <p style={{ color: 'var(--text-secondary)' }}>Loading TechPulse...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated Hero View
  if (!me) {
    return (
      <>
        <header className="header">
          <div className="brand-container">
            <div className="brand-logo">⚡</div>
            <span className="brand-title">TechPulse</span>
          </div>
          <div>
            <button className="btn-secondary" onClick={handleDemoLogin} disabled={isDemoLoggingIn}>
              {isDemoLoggingIn ? 'Logging in...' : 'Launch Demo'}
            </button>
          </div>
        </header>

        <div className="hero-wrapper">
          <div className="hero-card">
            <div className="hero-pill">
              <span>🚀</span> Developer Intelligence Platform
            </div>
            <h1 className="hero-title">Your Code & Tech News in One Pulse</h1>
            <p className="hero-desc">
              Monitor your GitHub commit cadence and repositories, track real-time discussions across Hacker News, Dev.to & Stack Overflow, and extract instant insights with AI summarization.
            </p>

            <div className="hero-buttons">
              <a href="/api/auth/github">
                <button className="btn-primary" style={{ width: '100%' }}>
                  <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                  </svg>
                  Sign in with GitHub
                </button>
              </a>

              <button className="btn-secondary" onClick={handleDemoLogin} disabled={isDemoLoggingIn}>
                <span>✨</span> {isDemoLoggingIn ? 'Launching Demo...' : 'Instant Demo Access (No GitHub App Needed)'}
              </button>
            </div>

            <div className="feature-bullets">
              <div className="feature-item">
                <h4>GitHub Analytics</h4>
                <p>Repository counts, stars, forks, and daily commit timelines.</p>
              </div>
              <div className="feature-item">
                <h4>Live Developer Feed</h4>
                <p>Aggregated from Hacker News, Dev.to, and Stack Overflow.</p>
              </div>
              <div className="feature-item">
                <h4>Gemini AI Summaries</h4>
                <p>2-sentence executive developer digests with 1 click.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Toast notifications */}
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              <span>⚡</span> {t.message}
            </div>
          ))}
        </div>
      </>
    );
  }

  // Authenticated Dashboard
  const { repos, act, trend, news } = data;

  return (
    <>
      {/* Top Navigation */}
      <header className="header">
        <div className="brand-container">
          <div className="brand-logo">⚡</div>
          <span className="brand-title">TechPulse</span>
        </div>

        <nav className="nav-links">
          <button
            className={`nav-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📊 Overview
          </button>
          <button
            className={`nav-btn ${activeTab === 'news' ? 'active' : ''}`}
            onClick={() => setActiveTab('news')}
          >
            📰 News Feed {news?.items?.length ? `(${news.items.length})` : ''}
          </button>
          <button
            className={`nav-btn ${activeTab === 'trending' ? 'active' : ''}`}
            onClick={() => setActiveTab('trending')}
          >
            🔥 Trending
          </button>
          <button
            className={`nav-btn ${activeTab === 'repos' ? 'active' : ''}`}
            onClick={() => setActiveTab('repos')}
          >
            💻 My Repos
          </button>
          <button
            className={`nav-btn ${activeTab === 'bookmarks' ? 'active' : ''}`}
            onClick={() => setActiveTab('bookmarks')}
          >
            ⭐ Bookmarks ({bookmarks.length})
          </button>
        </nav>

        <div className="user-profile">
          {me.avatar && <img src={me.avatar} alt={me.login} className="user-avatar" />}
          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{me.login}</span>
          {me.isDemo && (
            <span className="badge" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
              Demo
            </span>
          )}
          <button className="btn-signout" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-container">
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div>
            {/* Top Metrics Row */}
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-info">
                  <h3>Total Repositories</h3>
                  <div className="metric-val">{repos?.total ?? '...'}</div>
                </div>
                <div className="metric-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>
                  📁
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-info">
                  <h3>Total Stars Earned</h3>
                  <div className="metric-val">{repos?.stars ?? '...'}</div>
                </div>
                <div className="metric-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' }}>
                  ★
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-info">
                  <h3>Total Forks</h3>
                  <div className="metric-val">{repos?.forks ?? '...'}</div>
                </div>
                <div className="metric-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
                  🍴
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-info">
                  <h3>Saved Bookmarks</h3>
                  <div className="metric-val">{bookmarks.length}</div>
                </div>
                <div className="metric-icon" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa' }}>
                  📌
                </div>
              </div>
            </div>

            {/* Charts Row */}
            <div className="charts-grid">
              {/* Language Distribution */}
              <div className="chart-card">
                <div className="card-header">
                  <h3 className="card-title"><span>💻</span> Primary Languages</h3>
                </div>
                {!repos ? (
                  <div className="skeleton" style={{ height: 220 }} />
                ) : repos.error ? (
                  <p style={{ color: 'var(--accent-rose)', fontSize: '0.85rem' }}>{repos.error}</p>
                ) : repos.languages?.length ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={repos.languages} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
                      <XAxis dataKey="name" fontSize={11} stroke="#9ca3af" />
                      <YAxis allowDecimals={false} fontSize={11} stroke="#9ca3af" width={28} />
                      <Tooltip
                        contentStyle={{ background: '#1f2937', borderColor: '#374151', borderRadius: 8, color: '#fff' }}
                      />
                      <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No language data available.</p>
                )}
              </div>

              {/* Commit Timeline */}
              <div className="chart-card">
                <div className="card-header">
                  <h3 className="card-title"><span>📈</span> Commits Per Day</h3>
                </div>
                {!act ? (
                  <div className="skeleton" style={{ height: 220 }} />
                ) : act.error ? (
                  <p style={{ color: 'var(--accent-rose)', fontSize: '0.85rem' }}>{act.error}</p>
                ) : Array.isArray(act) && act.length ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={act} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
                      <XAxis
                        dataKey="date"
                        fontSize={10}
                        stroke="#9ca3af"
                        tickFormatter={(val) => val.slice(5)}
                      />
                      <YAxis allowDecimals={false} fontSize={11} stroke="#9ca3af" width={28} />
                      <Tooltip
                        contentStyle={{ background: '#1f2937', borderColor: '#374151', borderRadius: 8, color: '#fff' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="commits"
                        stroke="#10b981"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#10b981' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No recent commit activity found.</p>
                )}
              </div>
            </div>

            {/* Quick Overview Columns: Trending & News Highlights */}
            <div className="charts-grid">
              <div className="chart-card">
                <div className="card-header">
                  <h3 className="card-title"><span>🔥</span> Top Trending Repos</h3>
                  <button className="nav-btn" onClick={() => setActiveTab('trending')} style={{ fontSize: '0.8rem' }}>
                    View All →
                  </button>
                </div>
                <div className="card-list">
                  {Array.isArray(trend) &&
                    trend.slice(0, 4).map((r) => (
                      <div key={r.name} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.65rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <a href={r.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                            {r.name}
                          </a>
                          <span style={{ fontSize: '0.8rem', color: '#fbbf24' }}>★ {r.stars}</span>
                        </div>
                        <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                          {r.description?.slice(0, 85)}...
                        </p>
                      </div>
                    ))}
                </div>
              </div>

              <div className="chart-card">
                <div className="card-header">
                  <h3 className="card-title"><span>📰</span> Top Developer Discussions</h3>
                  <button className="nav-btn" onClick={() => setActiveTab('news')} style={{ fontSize: '0.8rem' }}>
                    View Feed →
                  </button>
                </div>
                <div className="card-list">
                  {news?.items?.slice(0, 4).map((it) => (
                    <div key={it.url} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.65rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <a href={it.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          {it.title.slice(0, 75)}...
                        </a>
                        <span className="badge badge-devto" style={{ fontSize: '0.7rem' }}>{it.source}</span>
                      </div>
                      <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.5rem' }}>
                        <button className="btn-action" onClick={() => handleSummarize(it)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
                          AI Summary
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: NEWS & DISCUSSIONS */}
        {activeTab === 'news' && (
          <div>
            <div className="controls-bar">
              <div className="filter-pills">
                {['all', 'Dev.to', 'Hacker News', 'Stack Overflow', 'NewsAPI'].map((src) => (
                  <button
                    key={src}
                    className={`pill-btn ${sourceFilter === src ? 'active' : ''}`}
                    onClick={() => setSourceFilter(src)}
                  >
                    {src === 'all' ? 'All Sources' : src}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="Search articles & discussions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>

            {/* Source Status Indicators */}
            {news?.status && (
              <div style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {Object.entries(news.status).map(([k, v]) => (
                  <span key={k}>
                    <span style={{ color: v === 'online' ? '#10b981' : '#f59e0b' }}>●</span> {k}: {v}
                  </span>
                ))}
              </div>
            )}

            {!news ? (
              <div className="card-list">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 110 }} />
                ))}
              </div>
            ) : filteredNews.length === 0 ? (
              <div className="empty-state">
                <p>No articles match your current filter or search criteria.</p>
              </div>
            ) : (
              <div className="card-list">
                {filteredNews.map((it) => {
                  const isSaved = bookmarks.some((b) => b.url === it.url);
                  const aiState = aiSummaries[it.url];

                  let badgeClass = 'badge-devto';
                  if (it.source === 'Hacker News') badgeClass = 'badge-hn';
                  if (it.source === 'Stack Overflow') badgeClass = 'badge-so';
                  if (it.source === 'NewsAPI') badgeClass = 'badge-newsapi';

                  return (
                    <div key={it.url} className="item-card">
                      <div className="item-meta">
                        <span className={`badge ${badgeClass}`}>{it.source}</span>
                        {it.author && <span>by {it.author}</span>}
                        {it.score !== undefined && it.score > 0 && <span>▲ {it.score}</span>}
                        {it.time && <span>{new Date(it.time).toLocaleDateString()}</span>}
                      </div>

                      <h3 className="item-title">
                        <a href={it.url} target="_blank" rel="noreferrer">
                          {it.title}
                        </a>
                      </h3>

                      {it.snippet && <p className="item-snippet">{it.snippet}</p>}

                      <div className="item-actions">
                        <button
                          className="btn-action"
                          onClick={() => handleSummarize(it)}
                          disabled={aiState?.status === 'loading'}
                        >
                          <span>🤖</span>
                          {aiState?.status === 'loading' ? 'Generating...' : 'Summarize with AI'}
                        </button>

                        <button
                          className={`btn-action ${isSaved ? 'bookmarked' : ''}`}
                          onClick={() => handleToggleBookmark(it)}
                        >
                          <span>{isSaved ? '★' : '☆'}</span>
                          {isSaved ? 'Saved' : 'Save'}
                        </button>

                        <a href={it.url} target="_blank" rel="noreferrer">
                          <button className="btn-action">
                            <span>↗</span> Open Link
                          </button>
                        </a>
                      </div>

                      {/* AI Summary result card */}
                      {aiState && (
                        <div className="ai-summary-box">
                          <div className="ai-summary-header">
                            <span>
                              AI Summary {aiState.fallback ? '(Offline Preview)' : `(${aiState.model || 'Gemini'})`}
                            </span>
                            {aiState.status === 'done' && (
                              <button
                                className="btn-action"
                                style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
                                onClick={() => handleCopy(aiState.text)}
                              >
                                Copy
                              </button>
                            )}
                          </div>
                          <div className="ai-summary-text">{aiState.text}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: TRENDING REPOSITORIES */}
        {activeTab === 'trending' && (
          <div>
            <div className="controls-bar">
              <div className="filter-pills">
                {['all', 'TypeScript', 'Python', 'JavaScript', 'Rust', 'Go'].map((lang) => (
                  <button
                    key={lang}
                    className={`pill-btn ${languageFilter === lang ? 'active' : ''}`}
                    onClick={() => setLanguageFilter(lang)}
                  >
                    {lang === 'all' ? 'All Languages' : lang}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="Search trending repos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>

            {!trend ? (
              <div className="card-list">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 110 }} />
                ))}
              </div>
            ) : filteredTrending.length === 0 ? (
              <div className="empty-state">
                <p>No trending repositories found matching your filter.</p>
              </div>
            ) : (
              <div className="card-list">
                {filteredTrending.map((r) => {
                  const isSaved = bookmarks.some((b) => b.url === r.url);
                  return (
                    <div key={r.name} className="item-card">
                      <div className="item-meta">
                        <span className="badge badge-github">GitHub</span>
                        {r.language && (
                          <span className="badge" style={{ background: '#1e293b', color: '#93c5fd' }}>
                            {r.language}
                          </span>
                        )}
                        <span style={{ color: '#fbbf24', fontWeight: 600 }}>★ {r.stars?.toLocaleString()}</span>
                        {r.forks !== undefined && <span>🍴 {r.forks?.toLocaleString()}</span>}
                      </div>

                      <h3 className="item-title">
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.name}
                        </a>
                      </h3>

                      <p className="item-snippet">{r.description}</p>

                      <div className="item-actions">
                        <button
                          className={`btn-action ${isSaved ? 'bookmarked' : ''}`}
                          onClick={() => handleToggleBookmark({ ...r, title: r.name, source: 'GitHub' })}
                        >
                          <span>{isSaved ? '★' : '☆'}</span>
                          {isSaved ? 'Saved' : 'Save'}
                        </button>
                        <a href={r.url} target="_blank" rel="noreferrer">
                          <button className="btn-action">
                            <span>↗</span> View on GitHub
                          </button>
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: MY REPOSITORIES & ACTIVITY */}
        {activeTab === 'repos' && (
          <div>
            <div className="charts-grid" style={{ marginBottom: '1.5rem' }}>
              <div className="chart-card" style={{ gridColumn: '1/-1' }}>
                <div className="card-header">
                  <h3 className="card-title"><span>📈</span> 14-Day Push Activity</h3>
                </div>
                {Array.isArray(act) && act.length ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={act} margin={{ top: 10, right: 20, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
                      <XAxis dataKey="date" fontSize={11} stroke="#9ca3af" />
                      <YAxis allowDecimals={false} fontSize={11} stroke="#9ca3af" width={28} />
                      <Tooltip
                        contentStyle={{ background: '#1f2937', borderColor: '#374151', borderRadius: 8, color: '#fff' }}
                      />
                      <Line type="monotone" dataKey="commits" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p style={{ color: 'var(--text-muted)' }}>No recent commit activity found.</p>
                )}
              </div>
            </div>

            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '1rem' }}>Your Repositories</h3>
            {repos?.repositories?.length ? (
              <div className="card-list">
                {repos.repositories.map((repo) => (
                  <div key={repo.name} className="item-card">
                    <div className="item-meta">
                      {repo.language && (
                        <span className="badge" style={{ background: '#1e293b', color: '#93c5fd' }}>
                          {repo.language}
                        </span>
                      )}
                      <span>★ {repo.stars}</span>
                      <span>🍴 {repo.forks}</span>
                    </div>
                    <h3 className="item-title">
                      {repo.url ? (
                        <a href={repo.url} target="_blank" rel="noreferrer">
                          {repo.name}
                        </a>
                      ) : (
                        repo.name
                      )}
                    </h3>
                    {repo.description && <p className="item-snippet">{repo.description}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>No repositories to display.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: SAVED BOOKMARKS */}
        {activeTab === 'bookmarks' && (
          <div>
            <div className="card-header" style={{ marginBottom: '1.2rem' }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Your Saved Articles & Repositories</h2>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {bookmarks.length} {bookmarks.length === 1 ? 'item' : 'items'} saved
              </span>
            </div>

            {bookmarks.length === 0 ? (
              <div className="empty-state">
                <p>No bookmarks saved yet.</p>
                <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.5rem' }}>
                  Click "Save" on any news article or trending repository to bookmark it here for later.
                </small>
              </div>
            ) : (
              <div className="card-list">
                {bookmarks.map((b) => (
                  <div key={b.id} className="item-card">
                    <div className="item-meta">
                      <span className="badge badge-devto">{b.source}</span>
                      {b.createdAt && <span>Saved {new Date(b.createdAt).toLocaleDateString()}</span>}
                    </div>

                    <h3 className="item-title">
                      <a href={b.url} target="_blank" rel="noreferrer">
                        {b.title}
                      </a>
                    </h3>

                    <div className="item-actions">
                      <a href={b.url} target="_blank" rel="noreferrer">
                        <button className="btn-action">
                          <span>↗</span> Visit
                        </button>
                      </a>
                      <button
                        className="btn-action"
                        style={{ color: 'var(--accent-rose)', borderColor: 'rgba(244, 63, 94, 0.3)' }}
                        onClick={() => handleToggleBookmark(b)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating Toast Notification Container */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>⚡</span> {t.message}
          </div>
        ))}
      </div>
    </>
  );
}
