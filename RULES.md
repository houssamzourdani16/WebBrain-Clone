# Clone WebBrain — Project Rules

These rules are binding for every change in this repository. Read them before editing any file.

## §1 Project Identity

- The project name is **Clone WebBrain**. It must appear verbatim in `manifest.json`, UI headers,
  `console.log` prefixes and documentation.
- Do NOT use the names "Farming Extension" or "FarmHub" anywhere in code, comments, docs, commits,
  fixtures, sample data or UI copy.
- Console log prefix convention: `[Clone WebBrain]`.

## §2 Architecture Boundaries

- The **extension** may only contain: (a) the Vercel API base URL, (b) the extension API key,
  both persisted in `chrome.storage.local`. No secrets, no database drivers, no npm packages.
- The **Vercel API** (`api/server.js`) is the only component that talks to MongoDB Atlas. It reads
  `MONGODB_URI`, `EXTENSION_API_KEY` and `ADMIN_API_KEY` from environment variables.
- MongoDB database name: `clone_webbrain_tasks`. Collection: `tasks`.
- `public/manage.html` is a static admin page served by Vercel and talks only to the API.
- WebBrain automation happens through the WebBrain MCP server (`webbrain_run` with `mode="act"`),
  never by embedding automation credentials in this repository.

## §3 Data Model

Every document in `tasks` follows this shape:

```js
{
  day: 1,                 // Number, 1-30, unique
  title: "…",             // String, short label
  prompt: "…",            // String, instruction for the AI agent
  details: "…",           // String, extra context / acceptance criteria
  status: "pending",      // "pending" | "done"
  completedAt: null,      // Date | null
  completedBy: null       // String | null ("ai_agent")
}
```

Only the AI agent (via `PATCH /api/tasks/:day` with `X-API-Key`) may set `status: "done"`.
The popup is read-only for task status.

## §4 Privacy & Credential Handling

- NEVER put `MONGODB_URI`, `ADMIN_API_KEY`, database user/password, or any Atlas credential in:
  the extension bundle, `manifest.json`, `chrome.storage`, `localStorage` of the extension,
  source-controlled `.env` files, screenshots or documentation examples that look real.
- The extension stores exactly two values: `cloneWebBrain.apiBaseUrl` and
  `cloneWebBrain.extensionApiKey`.
- `ADMIN_API_KEY` lives only in `localStorage` of the admin pages (`manage.html`, `settings.html`),
  entered manually by the owner.
- AI provider keys are never stored in MongoDB. If a page collects one, it stays in that browser's
  `localStorage` and is never transmitted to the API.
- `.env` is git-ignored. `.env.example` must contain placeholders only.
- Never log secrets. Redact any key before logging (`sk_live_…` → `sk_…`).
- Any newly discovered credential leak must be reported and rotated.

## §5 API Documentation Requirement

Any new or changed endpoint MUST be documented in:

1. The header comment block of `api/server.js`.
2. The "API Reference" table in `README.md`.
3. The endpoint list in `AI_CONTEXT.md`.

Documentation must include: method, path, auth header, request body, response shape and
status codes. An endpoint without documentation is considered incomplete.

## §6 Code Style & Validation

- API and tooling: CommonJS (`require`/`module.exports`) for Vercel Node functions, ES modules for
  `scripts/*.mjs`.
- The extension uses plain HTML/CSS/JS only — no bundlers, no frameworks, no npm packages.
- All JS must pass `node --check <file>` before being committed.
- Serverless MongoDB access must use the global connection cache pattern; never call
  `mongoose.connect()` per request without caching.
- CORS must stay permissive for `chrome-extension://` origins and the admin page.
- Respect `Content-Type: application/json` on every API response.
