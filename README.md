# Clone WebBrain

A 30-day Facebook task system for the **Clone WebBrain** Chrome extension.

- **MongoDB Atlas** stores one document per day in `clone_webbrain_tasks.tasks`.
- **Vercel API** (`api/server.js`) exposes read endpoints for the extension and protected write
  endpoints for the AI agent and the admin page.
- **CRUD website** (`public/manage.html`) lets the owner add, edit and delete tasks.
- **Extension popup** shows the 30-day checklist and refreshes from the API.
- **WebBrain MCP** performs the actual Facebook actions, day by day.
- **`DAILY_AGENT_PROMPT.md`** is the prompt you paste into the agent each day.

> **Security model:** MongoDB credentials live **only** in Vercel environment variables. The
> extension stores exactly two values in `chrome.storage.local`: the API base URL and the extension
> API key. See [RULES.md §4](RULES.md).

---

## Project structure

```text
clone-webbrain/
├── api/
│   └── server.js            # Vercel serverless API (mongoose, CRUD, CORS, auth)
├── public/
│   └── manage.html          # Admin CRUD page (X-Admin-Key)
├── popup/
│   ├── popup.html           # "Daily Tasks" tab + settings
│   └── popup.js             # chrome.storage.local + GET /api/tasks
├── scripts/
│   ├── seed.mjs             # Seeds/re-seeds 30 tasks safely
│   └── tasks-data.mjs       # The 30 Facebook automation tasks
├── icons/                   # Extension icons (16/48/128)
├── background.js            # MV3 service worker
├── manifest.json            # "Clone WebBrain"
├── vercel.json              # Rewrites /api/tasks[/:day] → /api/server
├── DAILY_AGENT_PROMPT.md    # Daily prompt for the AI agent
├── .vscode/mcp.json         # WebBrain MCP server
├── .env.example             # Placeholders only
├── AI_CONTEXT.md            # Architecture context for AI assistants
└── RULES.md                 # Project rules (privacy, API docs, code style)
```

---

## MongoDB Setup

1. Create a free **M0** cluster at [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Create a database user with read/write access (Atlas → Database Access).
3. Allow your Vercel egress: Atlas → Network Access → add `0.0.0.0/0` (simplest) or Vercel's
   published IP ranges for stricter setups.
4. Database name: **`clone_webbrain_tasks`**, collection: **`tasks`**. Both are created
   automatically on first write.
5. Copy the connection string and keep it for the Vercel env var:

   ```text
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/clone_webbrain_tasks?retryWrites=true&w=majority
   ```

6. Seed the 30 tasks locally:

   ```bash
   copy .env.example .env      # Windows (cp on macOS/Linux)
   # edit .env and set MONGODB_URI
   npm install
   npm run seed
   ```

   Local seeding requires Node 20.6+ (for `--env-file`); the Vercel function itself runs on Node 18+.
   The seed uses `$setOnInsert`, so re-running it **never resets** tasks the AI already completed.
   Expected documents in `tasks`:

   ```js
   {
     day: 1,                          // 1-30, unique
     title: "Publish an organic…",    // short label
     prompt: "Write and publish…",    // instruction for the AI agent
     details: "3-4 friendly…",        // extra context / acceptance criteria
     status: "pending",               // "pending" | "done"
     completedAt: null,               // Date | null
     completedBy: null                // "ai_agent" | "admin" | null
   }
   ```

7. Optional: create the unique index manually in Atlas (`{ day: 1 }`, unique). `api/server.js`
   declares it on the schema and `scripts/seed.mjs` calls `createIndexes()`.

**MongoDB credentials are NEVER in the Chrome extension.** The extension never imports a database
driver; it only talks to the Vercel API over HTTPS.

---

## Vercel API Deployment

1. Install the CLI and log in:

   ```bash
   npm i -g vercel
   vercel login
   ```

2. From the repository root, link and deploy:

   ```bash
   vercel link
   vercel            # preview deployment
   vercel --prod     # production
   ```

   `vercel.json` rewrites `/api/tasks` and `/api/tasks/:day` to the single function
   `api/server.js`, so the public URLs stay clean.

3. Add the environment variables in **Vercel → Project → Settings → Environment Variables**
   (Production + Preview + Development):

   | Variable | Purpose | Used by |
   | --- | --- | --- |
   | `MONGODB_URI` | Atlas connection string | API only |
   | `EXTENSION_API_KEY` | Read tasks + mark done (`X-API-Key`) | Extension / AI agent |
   | `ADMIN_API_KEY` | Create / edit / delete (`X-Admin-Key`) | `public/manage.html` |

   Generate strong keys:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Redeploy after adding variables (`vercel --prod`). Environment changes do not apply to
   existing deployments.

5. Smoke test:

   ```bash
   curl https://YOUR-PROJECT.vercel.app/api/health
   curl https://YOUR-PROJECT.vercel.app/api/tasks
   ```

### Connection caching

`api/server.js` keeps the Mongoose connection in `global.__cloneWebBrainMongoose`
(`{ conn, promise, Task }`). Warm invocations reuse the pool (`maxPoolSize: 10`), which prevents
Atlas connection exhaustion in serverless. A failed connection resets the cached promise so the
next request can retry.

---

## CRUD Website

Open `https://YOUR-PROJECT.vercel.app/manage.html`.

1. Enter the **API base URL** (prefilled with the current origin) and your **`ADMIN_API_KEY`**.
2. The key is saved in this browser's `localStorage` and sent as the `X-Admin-Key` header.
3. The page lists all tasks sorted by day, with live counts (total / done / pending / progress).
4. **+ Add task** opens a dialog (day, title, prompt, details, optional "mark as done").
5. **Edit** updates title, prompt, details or status. The day number is fixed — delete and
   recreate to move a task to another day.
6. **Delete** removes the task after a confirmation prompt.
7. **Refresh** reloads from MongoDB; search and status filters work client-side.

Notes:
- The page is `noindex, nofollow` and should be treated as private.
- If you clear the key with **Lock / change key**, the saved key is removed from `localStorage`.
- CORS is handled by the API; no proxy is required.

---

## Extension Task Tab

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select this
   repository folder.
2. Confirm the extension card shows **Clone WebBrain**.
3. Click the toolbar icon, open the **Settings** tab and enter:
   - **API base URL** — e.g. `https://your-project.vercel.app`
   - **Extension API key** — the `EXTENSION_API_KEY` value from Vercel
4. Press **Save settings** (or **Test** to validate without saving).
5. Open **Daily Tasks**. The popup calls `GET /api/tasks` with the `X-API-Key` header and renders:
   - Day badge and task title
   - ✅ Done / ⏳ Pending status
   - Two-line prompt preview (hover for the full prompt + details)
   - Completion metadata (`ai_agent · date`) for finished tasks
   - Progress summary at the top
6. **Refresh** re-fetches the list after the AI agent marks a task done.
7. **Open CRUD page** (Settings tab) opens `<API base URL>/manage.html`.

Read-only by design: the checkboxes are disabled. Only the AI agent can change status, through
`PATCH /api/tasks/:day`. The extension stores nothing else — no MongoDB URI, no admin key.

---

## Daily AI Agent Workflow (WebBrain)

1. Install the **WebBrain** Chrome extension.
2. In WebBrain: **Settings → General → Advanced → Cloud bridge** → set the URL to
   `ws://127.0.0.1:17374/extension` and enable it.
3. This repository's `.vscode/mcp.json` registers the MCP server:

   ```json
   {
     "mcpServers": {
       "webbrain": {
         "command": "npx",
         "args": ["-y", "@webbrain/mcp-server"]
       }
     }
   }
   ```

4. Open `DAILY_AGENT_PROMPT.md`, copy the prompt block, replace `{{API_BASE_URL}}`,
   `{{EXTENSION_API_KEY}}` and `{{DAY}}`, then send it to the agent.
5. The agent will:
   - `GET /api/tasks/{day}` and read `prompt` + `details`
   - use `webbrain_run` with `mode="act"` on `facebook.com` with human-like delays
     (2-5 s between actions, character-by-character typing, slow scrolling)
   - verify the visible result
   - `PATCH /api/tasks/{day}` with `{ "status": "done", "completedBy": "ai_agent" }`
   - leave the task **pending** and report the blocker on failure
6. Open the Clone WebBrain popup and press **Refresh** — the status is now ✅ Done.

> The Clone WebBrain extension popup will reflect the updated status after a refresh.

Safety: the prompt forbids security changes, spending money, deleting reviews and bypassing
checkpoints/captchas. If Facebook challenges the session, the agent must stop and report.

---

## API Reference

Base URL: `https://YOUR-PROJECT.vercel.app`. All responses are JSON, `Cache-Control: no-store`.
CORS allows `chrome-extension://` origins and the admin page, with headers
`Content-Type, X-API-Key, X-Admin-Key`.

| Method | Path | Auth | Body | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/tasks` | none | — | `200 { tasks, count }` (`?status=pending\|done` optional) | `500` |
| `GET` | `/api/tasks/:day` | none | — | `200 { task }` | `400`, `404`, `500` |
| `PATCH` | `/api/tasks/:day` | `X-API-Key` (status only) or `X-Admin-Key` (full edit) | `{ status, completedBy }` or `{ title, prompt, details, status }` | `200 { task }` | `400`, `401`, `404`, `500` |
| `POST` | `/api/tasks` | `X-Admin-Key` | `{ day, title, prompt?, details?, status? }` | `201 { task }` | `400`, `401`, `409`, `500` |
| `DELETE` | `/api/tasks/:day` | `X-Admin-Key` | — | `200 { deleted: true, day }` | `400`, `401`, `404`, `500` |
| `GET` | `/api/health` | none | — | `200 { ok, db, time }` | `200` (reports `disconnected`) |
| `OPTIONS` | any | none | — | `204` | — |

### Examples

```bash
# Public list
curl https://YOUR-PROJECT.vercel.app/api/tasks

# Public single task (used by the AI agent)
curl https://YOUR-PROJECT.vercel.app/api/tasks/7

# Mark done (AI agent)
curl -X PATCH https://YOUR-PROJECT.vercel.app/api/tasks/7 \
  -H "X-API-Key: $EXTENSION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"done","completedBy":"ai_agent"}'

# Create (admin)
curl -X POST https://YOUR-PROJECT.vercel.app/api/tasks \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"day":31,"title":"Extra task","prompt":"…","details":"…"}'

# Delete (admin)
curl -X DELETE https://YOUR-PROJECT.vercel.app/api/tasks/31 \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

Validation rules: `day` must be an integer 1-30; `status` must be `pending` or `done`;
`title` ≤ 200 chars; `prompt` ≤ 5000; `details` ≤ 10000; body ≤ 64 KB.

---

## Environment variables

Copy `.env.example` to `.env` for local seeding only. On Vercel, set the same names in the project
settings. `.env` is git-ignored.

```ini
MONGODB_URI=mongodb+srv://YOUR_DB_USER:YOUR_DB_PASSWORD@YOUR_CLUSTER.mongodb.net/clone_webbrain_tasks?retryWrites=true&w=majority
EXTENSION_API_KEY=replace-with-a-long-random-string
ADMIN_API_KEY=replace-with-a-different-long-random-string
```

---

## Verification & troubleshooting

```bash
npm run check     # node --check on api/server.js, popup/popup.js, background.js, seed
npm run seed      # confirm 30 documents in Mongo
curl https://YOUR-PROJECT.vercel.app/api/health
```

| Symptom | Fix |
| --- | --- |
| Popup: "Could not reach the API" | Wrong base URL, deployment asleep/failed, or CORS blocked — call `/api/health`. |
| Popup: "API key rejected" | `EXTENSION_API_KEY` in Vercel ≠ key saved in extension settings. |
| CRUD page: 401 | Wrong `ADMIN_API_KEY`, or env var added after the last deployment. |
| `500 Internal server error` | `MONGODB_URI` missing/invalid or Atlas Network Access not open to Vercel. |
| Empty task list | Database not seeded: `npm run seed`, or wrong database name. |
| `409` on create | Day already exists; edit the existing task or pick another day. |
| WebBrain MCP unavailable | Cloud bridge URL must be `ws://127.0.0.1:17374/extension` and enabled. |

## License

MIT.

