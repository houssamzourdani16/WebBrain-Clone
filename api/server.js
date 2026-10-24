'use strict';

/**
 * =============================================================================
 * Clone WebBrain — Task API (Vercel Node.js serverless function)
 * =============================================================================
 * Database : MongoDB Atlas — db "clone_webbrain_tasks", collection "tasks"
 * Env vars : MONGODB_URI, EXTENSION_API_KEY, ADMIN_API_KEY
 * Runtime  : Node 18+ (CommonJS). Only `mongoose` is required.
 *
 * The MongoDB connection is cached on `global` so warm serverless invocations
 * reuse the same socket pool instead of exhausting Atlas connections.
 *
 * -----------------------------------------------------------------------------
 * ENDPOINTS
 * -----------------------------------------------------------------------------
 * GET /api/tasks
 *   Auth   : none (public)
 *   Query  : ?status=pending|done (optional filter)
 *   Returns: 200 { tasks: Task[], count: number }
 *
 * GET /api/tasks/:day
 *   Auth   : none (public)
 *   Returns: 200 { task: Task } | 404 { error } | 400 { error } (day not 1-30)
 *
 * PATCH /api/tasks/:day
 *   Auth   : X-API-Key: EXTENSION_API_KEY  (AI agent, status only)
 *            X-Admin-Key: ADMIN_API_KEY    (admin page, full edit)
 *   Body   : { status: "done", completedBy: "ai_agent" }
 *            admin may also send { title, prompt, details, status, completedBy }
 *   Returns: 200 { task: Task } | 400 | 401 | 404
 *
 * POST /api/tasks
 *   Auth   : X-Admin-Key: ADMIN_API_KEY
 *   Body   : { day: 1-30, title, prompt?, details?, status?, completedBy? }
 *   Returns: 201 { task: Task } | 400 | 401 | 409 (day already exists)
 *
 * DELETE /api/tasks/:day
 *   Auth   : X-Admin-Key: ADMIN_API_KEY
 *   Returns: 200 { deleted: true, day: number } | 400 | 401 | 404
 *
 * GET /api/health
 *   Auth   : none
 *   Returns: 200 { ok: true, db: "connected" | "disconnected", time }
 *
 * GET /api/settings
 *   Auth   : none (contains no secrets)
 *   Returns: 200 { settings: Settings } — defaults merged with the saved document
 *
 * PUT /api/settings
 *   Auth   : X-Admin-Key: ADMIN_API_KEY
 *   Body   : { provider?, model?, temperature?, maxTokens?, language?, tone?,
 *              pageName?, pageUrl?, hashtags?, timezone?, dailyTime?,
 *              minDelayMs?, maxDelayMs?, typingDelayMs?, extraInstructions? }
 *   Returns: 200 { settings: Settings } | 400 | 401 | 500
 *
 * GET /api/agent-prompt?day=1-30
 *   Auth   : none (the prompt is generated without any API key value)
 *   Returns: 200 { day, model, prompt } | 400 | 404 | 500
 *
 * OPTIONS * → 204 (CORS preflight for the extension and the CRUD page)
 *
 * Routing note: `vercel.json` rewrites /api/tasks[/:day] to /api/server?path=…
 * so a single function file can serve the whole resource. When the function is
 * reached directly (vercel dev / node), the URL path is parsed instead.
 * =============================================================================
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const DB_NAME = 'clone_webbrain_tasks';
const COLLECTION = 'tasks';
const SETTINGS_COLLECTION = 'settings';
const MIN_DAY = 1;
const MAX_DAY = 30;
const MAX_BODY_BYTES = 64 * 1024;

/** Agent settings defaults. Never contains API keys or database credentials. */
const DEFAULT_SETTINGS = {
  provider: 'openai',
  model: 'gpt-4.1',
  temperature: 0.7,
  maxTokens: 2048,
  language: 'English',
  tone: 'friendly and professional',
  pageName: '',
  pageUrl: '',
  hashtags: '',
  timezone: 'UTC',
  dailyTime: '09:00',
  minDelayMs: 2000,
  maxDelayMs: 5000,
  typingDelayMs: 80,
  extraInstructions: ''
};

// ---------------------------------------------------------------------------
// Global (cross-invocation) cache — required on Vercel
// ---------------------------------------------------------------------------
const globalKey = '__cloneWebBrainMongoose';
let cached = global[globalKey];
if (!cached) {
  cached = global[globalKey] = { conn: null, promise: null, Task: null, Settings: null };
}

const taskSchema = new mongoose.Schema(
  {
    day: {
      type: Number,
      required: true,
      unique: true,
      min: MIN_DAY,
      max: MAX_DAY
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    prompt: { type: String, default: '', trim: true, maxlength: 5000 },
    details: { type: String, default: '', trim: true, maxlength: 10000 },
    status: {
      type: String,
      enum: ['pending', 'done'],
      default: 'pending',
      index: true
    },
    completedAt: { type: Date, default: null },
    completedBy: { type: String, default: null, trim: true, maxlength: 100 }
  },
  {
    timestamps: true,
    versionKey: false,
    collection: COLLECTION,
    minimize: false
  }
);

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'agent', unique: true, index: true },
    provider: {
      type: String,
      enum: ['openai', 'anthropic', 'google', 'openrouter', 'custom'],
      default: DEFAULT_SETTINGS.provider
    },
    model: { type: String, default: DEFAULT_SETTINGS.model, trim: true, maxlength: 100 },
    temperature: { type: Number, default: DEFAULT_SETTINGS.temperature, min: 0, max: 2 },
    maxTokens: { type: Number, default: DEFAULT_SETTINGS.maxTokens, min: 256, max: 32000 },
    language: { type: String, default: DEFAULT_SETTINGS.language, trim: true, maxlength: 40 },
    tone: { type: String, default: DEFAULT_SETTINGS.tone, trim: true, maxlength: 200 },
    pageName: { type: String, default: '', trim: true, maxlength: 100 },
    pageUrl: { type: String, default: '', trim: true, maxlength: 500 },
    hashtags: { type: String, default: '', trim: true, maxlength: 300 },
    timezone: { type: String, default: DEFAULT_SETTINGS.timezone, trim: true, maxlength: 60 },
    dailyTime: { type: String, default: DEFAULT_SETTINGS.dailyTime, trim: true, maxlength: 5 },
    minDelayMs: { type: Number, default: DEFAULT_SETTINGS.minDelayMs, min: 0, max: 60000 },
    maxDelayMs: { type: Number, default: DEFAULT_SETTINGS.maxDelayMs, min: 0, max: 60000 },
    typingDelayMs: { type: Number, default: DEFAULT_SETTINGS.typingDelayMs, min: 0, max: 1000 },
    extraInstructions: { type: String, default: '', trim: true, maxlength: 2000 }
  },
  {
    timestamps: true,
    versionKey: false,
    collection: SETTINGS_COLLECTION,
    minimize: false
  }
);

function getTaskModel() {
  if (!cached.Task) {
    cached.Task =
      mongoose.models.Task || mongoose.model('Task', taskSchema, COLLECTION);
  }
  return cached.Task;
}

function getSettingsModel() {
  if (!cached.Settings) {
    cached.Settings =
      mongoose.models.AgentSettings ||
      mongoose.model('AgentSettings', settingsSchema, SETTINGS_COLLECTION);
  }
  return cached.Settings;
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    const err = new Error('MONGODB_URI is not configured on the server');
    err.statusCode = 500;
    throw err;
  }
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    cached.promise = mongoose
      .connect(uri, {
        dbName: DB_NAME,
        maxPoolSize: 10,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        bufferCommands: false
      })
      .then((m) => m.connection);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // allow the next invocation to retry
    throw err;
  }
  return cached.conn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Admin-Key',
  'Access-Control-Max-Age': '86400'
};

function applyCors(req, res) {
  const origin = req.headers && req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function safeEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch (_err) {
    return false;
  }
}

function headerValue(req, name) {
  const headers = req.headers || {};
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function requireExtensionKey(req) {
  const provided = headerValue(req, 'x-api-key');
  if (!safeEqual(provided, process.env.EXTENSION_API_KEY)) {
    throw httpError(401, 'Unauthorized: invalid or missing X-API-Key');
  }
}

function requireAdminKey(req) {
  const provided = headerValue(req, 'x-admin-key');
  if (!safeEqual(provided, process.env.ADMIN_API_KEY)) {
    throw httpError(401, 'Unauthorized: invalid or missing X-Admin-Key');
  }
}

async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return req.body;
    }
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch (_err) {
      throw httpError(400, 'Request body must be valid JSON');
    }
  }

  const raw = await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });

  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (_err) {
    throw httpError(400, 'Request body must be valid JSON');
  }
}

function parseDay(value) {
  const day = Number(value);
  if (!Number.isInteger(day) || day < MIN_DAY || day > MAX_DAY) {
    throw httpError(400, `day must be an integer between ${MIN_DAY} and ${MAX_DAY}`);
  }
  return day;
}

function parseStatus(value) {
  if (value === undefined) return undefined;
  if (value !== 'pending' && value !== 'done') {
    throw httpError(400, 'status must be "pending" or "done"');
  }
  return value;
}

function cleanString(value, field, maxLength) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw httpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw httpError(400, `${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function parseNumber(value, field, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw httpError(400, `${field} must be a number between ${min} and ${max}`);
  }
  return num;
}

function parseInteger(value, field, min, max) {
  const num = parseNumber(value, field, min, max);
  if (!Number.isInteger(num)) throw httpError(400, `${field} must be an integer`);
  return num;
}

function serializeSettings(doc) {
  const raw = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc || {};
  const settings = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    settings[key] = raw[key] === undefined || raw[key] === null ? fallback : raw[key];
  }
  settings.updatedAt = raw.updatedAt || null;
  return settings;
}

function serializeTask(doc) {
  if (!doc) return null;
  const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(raw._id),
    day: raw.day,
    title: raw.title,
    prompt: raw.prompt || '',
    details: raw.details || '',
    status: raw.status,
    completedAt: raw.completedAt || null,
    completedBy: raw.completedBy || null,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null
  };
}

function routeParts(req) {
  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch (_err) {
    url = new URL('/', 'http://localhost');
  }

  const query = {};
  for (const [key, value] of url.searchParams.entries()) query[key] = value;
  if (req.query && typeof req.query === 'object') {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') query[key] = value;
    }
  }

  const rawPath = typeof query.path === 'string' ? query.path : url.pathname;
  const parts = rawPath
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== 'api' && segment !== 'server');

  return { parts, query };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function listTasks(req, res, query) {
  await connectDB();
  const Task = getTaskModel();
  const filter = {};
  const status = parseStatus(query.status);
  if (status) filter.status = status;

  const tasks = await Task.find(filter).sort({ day: 1 }).lean();
  send(res, 200, { tasks: tasks.map(serializeTask), count: tasks.length });
}

async function getTaskByDay(req, res, dayParam) {
  const day = parseDay(dayParam);
  await connectDB();
  const Task = getTaskModel();
  const task = await Task.findOne({ day }).lean();
  if (!task) throw httpError(404, `No task found for day ${day}`);
  send(res, 200, { task: serializeTask(task) });
}

async function createTask(req, res) {
  requireAdminKey(req);
  const body = await readJsonBody(req);
  const day = parseDay(body.day);
  const title = cleanString(body.title, 'title', 200);
  if (!title) throw httpError(400, 'title is required');

  const doc = {
    day,
    title,
    prompt: cleanString(body.prompt, 'prompt', 5000) || '',
    details: cleanString(body.details, 'details', 10000) || '',
    status: parseStatus(body.status) || 'pending',
    completedBy: cleanString(body.completedBy, 'completedBy', 100) || null,
    completedAt: null
  };
  if (doc.status === 'done') {
    doc.completedAt = new Date();
    doc.completedBy = doc.completedBy || 'admin';
  }

  await connectDB();
  const Task = getTaskModel();
  try {
    const created = await Task.create(doc);
    send(res, 201, { task: serializeTask(created) });
  } catch (err) {
    if (err && err.code === 11000) {
      throw httpError(409, `A task for day ${day} already exists`);
    }
    throw err;
  }
}

async function patchTask(req, res, dayParam) {
  const day = parseDay(dayParam);
  const body = await readJsonBody(req);

  const adminKey = headerValue(req, 'x-admin-key');
  const apiKey = headerValue(req, 'x-api-key');
  const isAdmin = safeEqual(adminKey, process.env.ADMIN_API_KEY);
  const isAgent = safeEqual(apiKey, process.env.EXTENSION_API_KEY);

  if (!isAdmin && !isAgent) {
    throw httpError(401, 'Unauthorized: provide a valid X-Admin-Key or X-API-Key');
  }

  const update = {};

  if (isAdmin) {
    if (body.title !== undefined) {
      const title = cleanString(body.title, 'title', 200);
      if (!title) throw httpError(400, 'title cannot be empty');
      update.title = title;
    }
    if (body.prompt !== undefined) update.prompt = cleanString(body.prompt, 'prompt', 5000) || '';
    if (body.details !== undefined) {
      update.details = cleanString(body.details, 'details', 10000) || '';
    }
    if (body.day !== undefined && parseDay(body.day) !== day) {
      throw httpError(400, 'day cannot be changed; delete and recreate the task instead');
    }
  }

  const status = parseStatus(body.status);
  if (status) {
    update.status = status;
    if (status === 'done') {
      update.completedAt = new Date();
      update.completedBy =
        cleanString(body.completedBy, 'completedBy', 100) || (isAdmin ? 'admin' : 'ai_agent');
    } else {
      update.completedAt = null;
      update.completedBy = null;
    }
  } else if (isAdmin && body.completedBy !== undefined) {
    update.completedBy = cleanString(body.completedBy, 'completedBy', 100) || null;
  }

  if (Object.keys(update).length === 0) {
    throw httpError(400, 'No supported fields provided (status, title, prompt, details)');
  }

  await connectDB();
  const Task = getTaskModel();
  const task = await Task.findOneAndUpdate(
    { day },
    { $set: update },
    { new: true, runValidators: true }
  ).lean();

  if (!task) throw httpError(404, `No task found for day ${day}`);
  send(res, 200, { task: serializeTask(task) });
}

async function deleteTask(req, res, dayParam) {
  requireAdminKey(req);
  const day = parseDay(dayParam);
  await connectDB();
  const Task = getTaskModel();
  const deleted = await Task.findOneAndDelete({ day }).lean();
  if (!deleted) throw httpError(404, `No task found for day ${day}`);
  send(res, 200, { deleted: true, day });
}

async function readSettings() {
  await connectDB();
  const Settings = getSettingsModel();
  const doc = await Settings.findOne({ key: 'agent' }).lean();
  return serializeSettings(doc);
}

async function getSettings(req, res) {
  send(res, 200, { settings: await readSettings() });
}

const ALLOWED_PROVIDERS = ['openai', 'anthropic', 'google', 'openrouter', 'custom'];

async function putSettings(req, res) {
  requireAdminKey(req);
  const body = await readJsonBody(req);
  const update = {};

  if (body.provider !== undefined) {
    if (!ALLOWED_PROVIDERS.includes(body.provider)) {
      throw httpError(400, `provider must be one of: ${ALLOWED_PROVIDERS.join(', ')}`);
    }
    update.provider = body.provider;
  }
  if (body.model !== undefined) {
    const model = cleanString(body.model, 'model', 100);
    if (!model) throw httpError(400, 'model cannot be empty');
    update.model = model;
  }
  if (body.temperature !== undefined) {
    update.temperature = parseNumber(body.temperature, 'temperature', 0, 2);
  }
  if (body.maxTokens !== undefined) {
    update.maxTokens = parseInteger(body.maxTokens, 'maxTokens', 256, 32000);
  }
  if (body.language !== undefined) {
    update.language = cleanString(body.language, 'language', 40) || DEFAULT_SETTINGS.language;
  }
  if (body.tone !== undefined) {
    update.tone = cleanString(body.tone, 'tone', 200) || DEFAULT_SETTINGS.tone;
  }
  if (body.pageName !== undefined) {
    update.pageName = cleanString(body.pageName, 'pageName', 100) || '';
  }
  if (body.pageUrl !== undefined) {
    const pageUrl = cleanString(body.pageUrl, 'pageUrl', 500) || '';
    if (pageUrl && !/^https?:\/\/.+/i.test(pageUrl)) {
      throw httpError(400, 'pageUrl must start with http:// or https://');
    }
    update.pageUrl = pageUrl;
  }
  if (body.hashtags !== undefined) {
    update.hashtags = cleanString(body.hashtags, 'hashtags', 300) || '';
  }
  if (body.timezone !== undefined) {
    update.timezone = cleanString(body.timezone, 'timezone', 60) || DEFAULT_SETTINGS.timezone;
  }
  if (body.dailyTime !== undefined) {
    const dailyTime = cleanString(body.dailyTime, 'dailyTime', 5) || '';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)) {
      throw httpError(400, 'dailyTime must use 24-hour HH:MM format');
    }
    update.dailyTime = dailyTime;
  }
  if (body.minDelayMs !== undefined) {
    update.minDelayMs = parseInteger(body.minDelayMs, 'minDelayMs', 0, 60000);
  }
  if (body.maxDelayMs !== undefined) {
    update.maxDelayMs = parseInteger(body.maxDelayMs, 'maxDelayMs', 0, 60000);
  }
  if (body.typingDelayMs !== undefined) {
    update.typingDelayMs = parseInteger(body.typingDelayMs, 'typingDelayMs', 0, 1000);
  }
  if (body.extraInstructions !== undefined) {
    update.extraInstructions = cleanString(body.extraInstructions, 'extraInstructions', 2000) || '';
  }

  if (Object.keys(update).length === 0) {
    throw httpError(400, 'No supported settings fields provided');
  }

  const current = await readSettings();
  const minDelay = update.minDelayMs === undefined ? current.minDelayMs : update.minDelayMs;
  const maxDelay = update.maxDelayMs === undefined ? current.maxDelayMs : update.maxDelayMs;
  if (minDelay > maxDelay) {
    throw httpError(400, 'minDelayMs cannot be greater than maxDelayMs');
  }

  const Settings = getSettingsModel();
  const doc = await Settings.findOneAndUpdate(
    { key: 'agent' },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  ).lean();

  send(res, 200, { settings: serializeSettings(doc) });
}

function requestBaseUrl(req) {
  const proto = String(headerValue(req, 'x-forwarded-proto') || 'https')
    .split(',')[0]
    .trim();
  const host = String(
    headerValue(req, 'x-forwarded-host') || headerValue(req, 'host') || 'localhost'
  )
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

function buildAgentPrompt(day, task, settings, baseUrl) {
  const pageLine = settings.pageName
    ? `Facebook Page: ${settings.pageName}`
    : 'Facebook Page: the page you are already logged into';
  const pageUrlLine = settings.pageUrl ? `Page URL: ${settings.pageUrl}` : 'Page URL: not configured';
  const hashtagsLine = settings.hashtags
    ? `Preferred hashtags: ${settings.hashtags}`
    : 'Hashtags: use 2-3 relevant hashtags';
  const extraBlock = settings.extraInstructions
    ? ['', 'OWNER EXTRA INSTRUCTIONS (highest priority)', settings.extraInstructions, '']
    : [''];

  return [
    'You are the Clone WebBrain daily execution agent.',
    '',
    'CONTEXT',
    `- Model to use: ${settings.model} (provider: ${settings.provider}, temperature: ${settings.temperature}, max tokens: ${settings.maxTokens})`,
    `- API base URL: ${baseUrl}`,
    `- Today's task day: ${day} (range 1-30)`,
    `- ${pageLine}`,
    `- ${pageUrlLine}`,
    `- Content language: ${settings.language}`,
    `- Tone: ${settings.tone}`,
    `- ${hashtagsLine}`,
    `- Scheduled run: ${settings.dailyTime} (${settings.timezone})`,
    `- Human delays: ${settings.minDelayMs}-${settings.maxDelayMs} ms between actions; ${settings.typingDelayMs} ms per keystroke`,
    '- Browser automation: WebBrain MCP server, tool webbrain_run with mode="act".',
    ...extraBlock,
    'STEP 1 - FETCH THE TASK',
    `GET ${baseUrl}/api/tasks/${day}`,
    'Header: X-API-Key: {{EXTENSION_API_KEY}}',
    'Header: Accept: application/json',
    'If the response is 404, stop and report that no task is configured for this day.',
    'If the response is 401, stop and report that the extension API key was rejected.',
    'If task.status is already "done", stop and report that the day is already complete.',
    '',
    'STEP 2 - READ THE TASK',
    `Title: ${task.title || ''}`,
    `Prompt: ${task.prompt || ''}`,
    `Details: ${task.details || ''}`,
    'Read the details completely before touching the browser. Do not invent assets, prices or claims.',
    '',
    'STEP 3 - EXECUTE ON FACEBOOK',
    `Open ${settings.pageUrl || 'https://www.facebook.com'} and confirm you are on the correct Page.`,
    `Use webbrain_run with mode="act". Write in ${settings.language} with a ${settings.tone} tone.`,
    `Wait ${settings.minDelayMs}-${settings.maxDelayMs} ms between meaningful actions.`,
    `Type character by character with about ${settings.typingDelayMs} ms per keystroke. Scroll slowly.`,
    'Never spam, never duplicate a post, never mass-message, and never bypass captchas or checkpoints.',
    'Do not change security settings, passwords, payment methods, ad billing, reviews or testimonials.',
    '',
    'STEP 4 - VERIFY',
    'Confirm the result is visible in the UI (post on the Page timeline, reply under the comment, updated profile field).',
    'Only continue when you can point to visible proof.',
    '',
    'STEP 5 - MARK DONE ONLY ON SUCCESS',
    `PATCH ${baseUrl}/api/tasks/${day}`,
    'Header: X-API-Key: {{EXTENSION_API_KEY}}',
    'Header: Content-Type: application/json',
    'Body: { "status": "done", "completedBy": "ai_agent" }',
    'If this PATCH fails, retry once after 3 seconds, then report the failure.',
    '',
    'STEP 6 - REPORT',
    'Report the day and title, what you did (max 6 bullets), proof of success, the PATCH status code, and any blocker.',
    '',
    'FAILURE POLICY',
    'If any step fails or the result cannot be verified, do NOT call PATCH. Leave the task pending and report the exact blocker.',
    'The Clone WebBrain extension popup will reflect the updated status after a refresh.'
  ].join('\n');
}

async function getAgentPrompt(req, res, query) {
  const day = parseDay(query.day);
  await connectDB();
  const Task = getTaskModel();
  const task = await Task.findOne({ day }).lean();
  if (!task) throw httpError(404, `No task found for day ${day}`);
  const settings = await readSettings();
  send(res, 200, {
    day,
    model: settings.model,
    provider: settings.provider,
    prompt: buildAgentPrompt(day, serializeTask(task), settings, requestBaseUrl(req))
  });
}

async function health(req, res) {
  let dbState = 'disconnected';
  try {
    await connectDB();
    dbState = cached.conn && cached.conn.readyState === 1 ? 'connected' : 'disconnected';
  } catch (_err) {
    dbState = 'disconnected';
  }
  send(res, 200, { ok: dbState === 'connected', db: dbState, time: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function route(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Content-Length', '0');
    res.end();
    return;
  }

  const { parts, query } = routeParts(req);
  const resource = parts[0];
  const dayParam = parts[1];

  const knownResources = ['tasks', 'health', 'settings', 'agent-prompt', 'prompt'];
  if (!resource) throw httpError(404, 'Not found. Use /api/tasks or /api/tasks/:day');
  if (!knownResources.includes(resource)) {
    throw httpError(404, `Unknown resource "${resource}"`);
  }

  if (resource === 'health') {
    if (req.method !== 'GET') throw httpError(405, 'Method not allowed');
    return health(req, res);
  }

  if (resource === 'settings') {
    if (dayParam) throw httpError(404, 'Settings does not accept a sub-path');
    if (req.method === 'GET') return getSettings(req, res);
    if (req.method === 'PUT' || req.method === 'PATCH') return putSettings(req, res);
    throw httpError(405, 'Method not allowed');
  }

  if (resource === 'agent-prompt' || resource === 'prompt') {
    if (req.method !== 'GET') throw httpError(405, 'Method not allowed');
    return getAgentPrompt(req, res, query);
  }

  if (!dayParam) {
    if (req.method === 'GET') return listTasks(req, res, query);
    if (req.method === 'POST') return createTask(req, res);
    throw httpError(405, 'Method not allowed');
  }

  if (req.method === 'GET') return getTaskByDay(req, res, dayParam);
  if (req.method === 'PATCH') return patchTask(req, res, dayParam);
  if (req.method === 'DELETE') return deleteTask(req, res, dayParam);
  throw httpError(405, 'Method not allowed');
}

module.exports = async function handler(req, res) {
  try {
    await route(req, res);
  } catch (err) {
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    if (statusCode >= 500) {
      console.error('[Clone WebBrain] API error:', err && err.stack ? err.stack : err);
    }
    if (!res.headersSent) {
      applyCors(req, res);
      send(res, statusCode, {
        error: statusCode >= 500 ? 'Internal server error' : err.message
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
};

// Vercel's Node runtime accepts both module.exports (above) and a named default.
module.exports.default = module.exports;



