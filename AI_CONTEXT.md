# Clone WebBrain — AI Context

Read this before modifying the project. It describes the current architecture, ownership of data,
endpoints and conventions. Companion documents: [RULES.md](RULES.md), [README.md](README.md),
[DAILY_AGENT_PROMPT.md](DAILY_AGENT_PROMPT.md).

## 1. What this project is

**Clone WebBrain** is a Chrome MV3 extension plus a Vercel-hosted API that tracks a 30-day
Facebook automation plan. Each day has one task (`day` 1-30) with a prompt and details. A human
owner manages tasks through a CRUD page; an AI agent executes them on `facebook.com` through the
WebBrain MCP server (`webbrain_run`, `mode="act"`) and marks them done through the API.

## 2. Component responsibilities

| Component | File(s) | Responsibility | Secrets it may hold |
| --- | --- | --- | --- |
| Chrome extension popup | `popup/popup.html`, `popup/popup.js` | Render 30-day checklist, refresh from API, configure base URL + key | `cloneWebBrain.apiBaseUrl`, `cloneWebBrain.extensionApiKey` in `chrome.storage.local` |
| Service worker | `background.js` | Seed storage defaults, ping handler, branding logs | none |
| Manifest | `manifest.json` | MV3 config, name **Clone WebBrain** | none |
| API | `api/server.js` | Mongo access, validation, auth, CORS, CRUD | `MONGODB_URI`, `EXTENSION_API_KEY`, `ADMIN_API_KEY` (env) |
| Admin page | `public/manage.html` | Table + add/edit/delete UI | `ADMIN_API_KEY` in page `localStorage` only |
| Settings page | `public/settings.html` | Model/voice/delay config (MongoDB) + browser-only keys + prompt generator | `ADMIN_API_KEY`, extension key, optional provider key in page `localStorage` only |
| Landing page | `public/index.html` | Explains the system, live stats, next task, setup steps | none |
| Seeder | `scripts/seed.mjs`, `scripts/tasks-data.mjs` | Upsert 30 sample tasks without resetting progress | `MONGODB_URI` via `--env-file` |
| MCP config | `.vscode/mcp.json` | Registers `@webbrain/mcp-server` as `webbrain` | none |
| Daily prompt | `DAILY_AGENT_PROMPT.md` | Copy-paste instructions for the agent | placeholders only |

**Hard rule:** MongoDB credentials are never present in the extension bundle, `manifest.json`,
`chrome.storage`, extension `localStorage`, or committed files.

## 3. Data model (MongoDB Atlas)

- Cluster: free **M0**.
- Database: **`clone_webbrain_tasks`**.
- Collection: **`tasks`**.
- Index: unique on `{ day: 1 }`; secondary index on `{ status: 1 }`.

```js
{
  _id: ObjectId,
  day: 1,                    // Number, required, unique, 1..30
  title: "…",                // String, required, <= 200
  prompt: "…",               // String, default "", <= 5000
  details: "…",              // String, default "", <= 10000
  status: "pending",         // "pending" | "done", default "pending"
  completedAt: null,         // Date | null (set when status -> done)
  completedBy: null,         // String | null ("ai_agent" | "admin")
  createdAt: Date,           // timestamps: true
  updatedAt: Date
}
```

API serialization adds `id` (string `_id`), `createdAt`, `updatedAt` and always returns
`completedAt`/`completedBy` as `null` when unset.

### Settings document (`settings` collection, single key `agent`)

Agent configuration lives in the same database, collection **`settings`**, one document with
`key: "agent"`. It never contains secrets.

```js
{
  key: "agent",
  provider: "openai",            // openai | anthropic | google | openrouter | custom
  model: "gpt-4.1",
  temperature: 0.7,              // 0..2
  maxTokens: 2048,               // 256..32000
  language: "English",
  tone: "friendly and professional",
  pageName: "",
  pageUrl: "",
  hashtags: "",
  timezone: "UTC",
  dailyTime: "09:00",            // HH:MM, 24h
  minDelayMs: 2000,              // 0..60000, <= maxDelayMs
  maxDelayMs: 5000,
  typingDelayMs: 80,             // 0..1000
  extraInstructions: "",
  updatedAt: Date
}
```

`GET /api/settings` merges defaults with the stored document. API keys are NOT part of this
document — the settings page keeps them in the browser's `localStorage` only.

## 4. API surface

Single Vercel Node function `api/server.js`. `vercel.json` rewrites:

```text
/api/tasks        → /api/server?path=tasks
/api/tasks/:day   → /api/server?path=tasks/:day
/api/health       → /api/server?path=health
```

The handler also parses the raw URL, so it works when invoked directly (`vercel dev`, local tests).

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/tasks` | public | Sorted by `day`; optional `?status=pending\|done`; returns `{ tasks, count }` |
| GET | `/api/tasks/:day` | public | Returns `{ task }`; `400` invalid day, `404` missing |
| PATCH | `/api/tasks/:day` | `X-API-Key` **or** `X-Admin-Key` | Agent: `{ status, completedBy }` only. Admin: also `title`, `prompt`, `details`; day immutable |
| POST | `/api/tasks` | `X-Admin-Key` | `{ day, title, prompt?, details?, status? }`; `409` if day exists |
| DELETE | `/api/tasks/:day` | `X-Admin-Key` | Returns `{ deleted: true, day }` |
| GET | `/api/settings` | public | Agent settings with defaults merged; no secrets |
| PUT | `/api/settings` | `X-Admin-Key` | Validate + upsert the singleton `agent` settings document |
| GET | `/api/agent-prompt?day=N` | public | Builds the full daily prompt from settings + task; returns `{ day, model, provider, prompt }` |
| GET | `/api/health` | public | `{ ok, db: "connected"\|"disconnected", time }` |
| OPTIONS | any | public | `204` CORS preflight |

Auth details:
- Keys compared with `crypto.timingSafeEqual` after a length check (`safeEqual`).
- `X-API-Key` is checked against `EXTENSION_API_KEY`; `X-Admin-Key` against `ADMIN_API_KEY`.
- If both headers are sent, admin permissions win.
- CORS reflects the request `Origin` (or `*`) and allows
  `Content-Type, X-API-Key, X-Admin-Key`. This supports `chrome-extension://` origins.

Error policy: JSON `{ error }`; `500` responses never leak stack traces (logged server-side with
the `[Clone WebBrain]` prefix).

## 5. Serverless Mongo pattern

`api/server.js` caches on `global.__cloneWebBrainMongoose`:

```js
let cached = global.__cloneWebBrainMongoose;
if (!cached) cached = global.__cloneWebBrainMongoose = { conn: null, promise: null, Task: null };
```

- One `mongoose.connect()` promise per cold start, reused by warm invocations.
- `maxPoolSize: 10`, `serverSelectionTimeoutMS: 10000`, `bufferCommands: false`.
- On connect failure the cached promise is reset so the next request retries.
- The model is compiled once (`mongoose.models.Task || mongoose.model(...)`), collection `tasks`.
- `dbName` is pinned to `clone_webbrain_tasks` so the URI database segment cannot drift.

Do not replace this with per-request connections or `mongoose.connect` in handlers.

## 6. Extension behaviour

- Manifest V3, `action.default_title` = **Clone WebBrain**, popup at `popup/popup.html`.
- Permissions: `storage`; host permissions for `https://*/*`, `http://localhost/*`,
  `http://127.0.0.1/*` so the popup can call any Vercel deployment.
- Storage keys (only these two):
  - `cloneWebBrain.apiBaseUrl` — normalized, trailing slashes stripped
  - `cloneWebBrain.extensionApiKey` — sent as `X-API-Key`
- Popup tabs:
  - **Daily Tasks** — fetches `GET /api/tasks` on open, shows day badge, title,
    ✅ Done / ⏳ Pending, two-line prompt preview, completion metadata, progress bar, Refresh.
    Checkboxes are `disabled` (read-only).
  - **Settings** — API base URL, extension API key, Save, Test, Open CRUD page, privacy notes.
- Error states: not configured (link to Settings), API key rejected, network/CORS failure,
  empty list (link to CRUD page). All fetch calls use a 15 s `AbortController` timeout.
- `chrome.storage` access is promisified manually (callback + `chrome.runtime.lastError`) for
  maximum compatibility; no npm packages, no bundler, no inline event handlers.
- Popup DOM is built with `createElement`/`textContent`; the admin page escapes interpolated HTML.

## 7. Admin page behaviour

`public/manage.html` is a single static file (inline CSS + JS, no CDN).
- Gate form asks for API base URL + `ADMIN_API_KEY`, persists both in `localStorage`
  (`cloneWebBrain.adminApiBase`, `cloneWebBrain.adminApiKey`), auto-reconnects on reload.
- Loads `GET /api/tasks`, sorts by day, renders stats, search and status filter.
- Add/Edit use a modal `<dialog>`; POST for new tasks, PATCH for existing (day disabled).
- Delete uses `window.confirm`.
- All API calls send `X-Admin-Key`; `401` forces the gate back open.
- It is served at `/manage.html` from `public/`; `vercel.json` sets `Cache-Control: no-store`.

`public/settings.html` shares the same admin gate and `localStorage` keys. It edits the `settings`
document (model, temperature, page, tone, delays), stores the extension key and an optional AI
provider key **in the browser only**, and generates/downloads the daily prompt from
`/api/agent-prompt`. CORS must keep `PUT` in `Access-Control-Allow-Methods`.

## 8. Daily AI agent flow

1. Human copies the prompt from `DAILY_AGENT_PROMPT.md` and fills `{{API_BASE_URL}}`,
   `{{EXTENSION_API_KEY}}`, `{{DAY}}`.
2. Agent executes `GET /api/tasks/{day}` (public, but header included).
3. Agent performs the task with WebBrain MCP: `webbrain_run`, `mode="act"`, target
   `https://www.facebook.com`, acting as the Page.
4. Human-like requirements: 2-5 s pauses between actions, 40-120 ms per keystroke, slow scrolling,
   no rapid loops, no duplicate posts.
5. Agent verifies visible success, then `PATCH /api/tasks/{day}`
   `{ "status": "done", "completedBy": "ai_agent" }` with `X-API-Key`.
6. On any failure it must NOT patch; the task stays pending and the blocker is reported.
7. The popup shows the new status after the user presses **Refresh**.

WebBrain Cloud bridge: Chrome extension → Settings → General → Advanced → Cloud bridge →
`ws://127.0.0.1:17374/extension` → enable. MCP server: `npx -y @webbrain/mcp-server`
(registered in `.vscode/mcp.json`).

## 9. Environment variables

| Name | Scope | Required | Notes |
| --- | --- | --- | --- |
| `MONGODB_URI` | Vercel + local seeding | yes | Includes db name `clone_webbrain_tasks`; never shipped to the client |
| `EXTENSION_API_KEY` | Vercel + extension + agent prompt | yes | Long random string; read + mark-done |
| `ADMIN_API_KEY` | Vercel + admin page | yes | Different long random string; create/edit/delete |

`.env` is git-ignored; `.env.example` ships placeholders only. `npm run seed` uses
`node --env-file=.env scripts/seed.mjs`.

## 10. Conventions & validation checklist

- Brand is always **Clone WebBrain**; logs use `[Clone WebBrain]`.
- No "Farming Extension" / "FarmHub" strings anywhere.
- `require`/`module.exports` in `api/server.js`; ESM in `scripts/*.mjs`; plain browser JS
  elsewhere (no modules in the popup).
- Before finishing a change:
  ```bash
  npm run check
  # also node --check the inline manage.html script if it changed
  ```
- Re-check `manifest.json` name/short_name/default_title and that the popup still loads with
  Chrome "Load unpacked".
- New endpoints must be documented in `api/server.js` header, README API table and section 4 here
  (RULES.md §5).

## 11. Known constraints

- Day numbers are immutable after creation (delete + recreate to move).
- `PATCH` with `X-API-Key` cannot edit title/prompt/details — only `status`/`completedBy`.
- Setting `status: "pending"` clears `completedAt`/`completedBy`.
- The extension never writes task status; there is no admin capability in the popup.
- CORS is permissive by design (extension origins are unpredictable); protection comes from the
  API keys, not from origin checks.
- Seed only inserts missing days (`$setOnInsert`); it will not overwrite owner edits or AI progress.

