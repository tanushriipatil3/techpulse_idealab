# ⚡ TechPulse — Developer Intelligence & Activity Hub

A full-stack developer intelligence platform integrating **Next.js 14**, **Express + Prisma ORM**, **FastAPI + Google Gemini AI**, and multi-source developer feeds (**Hacker News**, **Dev.to**, **Stack Overflow**, **GitHub API**, **NewsAPI**).

---

## 🏛️ System Architecture & Data Flow

```text
[ Browser / Frontend: Next.js (Port 3000) ]
                     │
                     │  /api/* (Next.js Rewrites)
                     ▼
  [ Backend Gateway: Express + Prisma (Port 4000) ]
       │            │                       │
       │            │ /summarize            ▼
       │            ▼             [ Database: SQLite / PostgreSQL ]
       │  [ AI Microservice: FastAPI (Port 8000) ]
       │            │
       │            ▼
       │  [ Google Gemini 1.5 Flash API ]
       ▼
[ External APIs: Hacker News, Dev.to, Stack Overflow, GitHub, NewsAPI ]
```

---

## 🚀 Quick Start (Zero-Configuration Mode)

The project is pre-configured with **SQLite** and **Demo Mode**, requiring no Docker installation or external API keys to start exploring immediately.

### 1. Prerequisites
- **Node.js**: v18+ (verified on v24)
- **Python**: 3.10+ (verified on 3.14)

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(Default values work immediately with SQLite and local ports 3000, 4000, and 8000).*

### 3. Start the AI Microservice (Port 8000)
```bash
cd ai
py -m pip install -r requirements.txt
py -m uvicorn main:app --port 8000
```
*(On Linux/macOS: `python3 -m pip install -r requirements.txt && python3 -m uvicorn main:app --port 8000`)*

### 4. Start the Backend API (Port 4000)
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run dev
```

### 5. Start the Frontend Application (Port 3000)
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
- Click **"Launch Demo (Instant Access)"** for instant full dashboard access.
- Or click **"Sign in with GitHub"** if OAuth keys are configured.

---

## 🔑 External API Integrations & Optional Keys

Add these variables to your `.env` file to activate external services:

| Service | Environment Variable | How to Obtain / Configure |
| :--- | :--- | :--- |
| **Google Gemini AI** | `GEMINI_API_KEY` | Get a free API key at [Google AI Studio](https://aistudio.google.com). Model defaults to `gemini-1.5-flash`. |
| **GitHub OAuth** | `GITHUB_CLIENT_ID`<br>`GITHUB_CLIENT_SECRET` | Create an OAuth app under **GitHub Settings > Developer Settings > OAuth Apps**.<br>• **Homepage URL**: `http://localhost:3000`<br>• **Authorization callback URL**: `http://localhost:3000/api/auth/github/callback` |
| **Dev.to Articles** | *(Built-in)* | **No key needed.** Pulls top developer discussions automatically. |
| **Hacker News** | *(Built-in)* | **No key needed.** Uses Firebase official Hacker News API. |
| **Stack Overflow** | `STACK_KEY` *(Optional)* | Uses Stack Exchange v2.3 hot questions. Key is optional. |
| **NewsAPI** | `NEWS_API_KEY` *(Optional)* | Optional tech news from [newsapi.org](https://newsapi.org). |
| **PostgreSQL (Docker)**| `DATABASE_URL` | Set `DATABASE_URL=postgresql://techpulse:techpulse@localhost:5432/techpulse` and change `provider = "postgresql"` in `backend/prisma/schema.prisma` if running Docker. |

---

## 🛠️ API Reference

### Authentication
- `POST /api/auth/demo` — Instant demo login session for grading / testing.
- `GET /api/auth/github` — Initiates GitHub OAuth 2.0 flow.
- `GET /api/auth/github/callback` — Handles OAuth code exchange and session creation.
- `POST /api/auth/logout` — Destroys session and clears cookie.
- `GET /api/me` — Returns current authenticated user profile.

### Dashboard & Analytics
- `GET /api/repos` — Returns user repository metrics, stargazers count, forks count, and language distribution.
- `GET /api/activity` — 14-day commit cadence from GitHub PushEvents.
- `GET /api/trending` — Top trending repositories (supports `?language=...&days=...`).

### Feeds & AI
- `GET /api/news` — Aggregates Hacker News, Dev.to, and Stack Overflow discussions (cached for 10 min).
- `POST /api/summarize` — Generates a 2-sentence developer insight using Google Gemini 1.5 Flash (with fallback preview if key is not configured).

### Bookmarks (Data Persistence)
- `GET /api/bookmarks` — Retrieves all bookmarked articles & repositories for current user.
- `POST /api/bookmarks` — Upserts bookmark (`{ url, title, source }`).
- `DELETE /api/bookmarks/:id` — Removes bookmark by ID.

---

## 🧪 Testing Verification
- **Health Check**: `GET http://localhost:4000/api/health`
- **AI Health Check**: `GET http://localhost:8000/health`
- **Frontend Page**: `GET http://localhost:3000`
