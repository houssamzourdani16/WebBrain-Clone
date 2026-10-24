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
const MIN_DAY = 1;
const MAX_DAY = 30;
const MAX_BODY_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Global (cross-invocation) cache — required on Vercel
// ---------------------------------------------------------------------------
const globalKey = '__cloneWebBrainMongoose';
let cached = global[globalKey];
if (!cached) {
  cached = global[globalKey] = { conn: null, promise: null, Task: null };
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

function getTaskModel() {
  if (!cached.Task) {
    cached.Task =
      mongoose.models.Task || mongoose.model('Task', taskSchema, COLLECTION);
  }
  return cached.Task;
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
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

  if (!resource) throw httpError(404, 'Not found. Use /api/tasks or /api/tasks/:day');
  if (resource !== 'tasks' && resource !== 'health') {
    throw httpError(404, `Unknown resource "${resource}"`);
  }

  if (resource === 'health') {
    if (req.method !== 'GET') throw httpError(405, 'Method not allowed');
    return health(req, res);
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



