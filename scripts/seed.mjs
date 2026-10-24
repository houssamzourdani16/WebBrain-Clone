/**
 * Clone WebBrain — seed MongoDB Atlas with the 30-day task list.
 *
 * Usage:
 *   copy .env.example .env      # then fill in MONGODB_URI
 *   node --env-file=.env scripts/seed.mjs
 *   # or: npm run seed
 *
 * Behaviour:
 *   - Connects to db "clone_webbrain_tasks", collection "tasks".
 *   - Upserts day 1..30 with $setOnInsert, so re-running NEVER resets the
 *     status/completedAt/completedBy of tasks the AI already finished.
 *   - Prints a summary and exits non-zero on failure.
 *
 * The MongoDB URI is read from the environment only. It must never be copied
 * into the Chrome extension.
 */
import mongoose from 'mongoose';
import { TASKS } from './tasks-data.mjs';

const DB_NAME = 'clone_webbrain_tasks';
const COLLECTION = 'tasks';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('[Clone WebBrain] MONGODB_URI is missing. Run with: node --env-file=.env scripts/seed.mjs');
  process.exit(1);
}

const taskSchema = new mongoose.Schema(
  {
    day: { type: Number, required: true, unique: true, min: 1, max: 30 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    prompt: { type: String, default: '', trim: true, maxlength: 5000 },
    details: { type: String, default: '', trim: true, maxlength: 10000 },
    status: { type: String, enum: ['pending', 'done'], default: 'pending' },
    completedAt: { type: Date, default: null },
    completedBy: { type: String, default: null, trim: true, maxlength: 100 }
  },
  { timestamps: true, versionKey: false, collection: COLLECTION }
);

const Task = mongoose.models.Task || mongoose.model('Task', taskSchema, COLLECTION);

async function main() {
  console.log('[Clone WebBrain] Connecting to MongoDB Atlas…');
  await mongoose.connect(uri, { dbName: DB_NAME, serverSelectionTimeoutMS: 15000 });
  console.log(`[Clone WebBrain] Connected to database "${DB_NAME}".`);

  await Task.createIndexes();

  const ops = TASKS.map((task) => ({
    updateOne: {
      filter: { day: task.day },
      update: {
        $setOnInsert: {
          day: task.day,
          title: task.title,
          prompt: task.prompt,
          details: task.details,
          status: 'pending',
          completedAt: null,
          completedBy: null
        }
      },
      upsert: true
    }
  }));

  const result = await Task.bulkWrite(ops, { ordered: false });
  const total = await Task.countDocuments({});

  console.log(
    `[Clone WebBrain] Seed complete. inserted=${result.upsertedCount} ` +
      `existing=${result.matchedCount} total=${total}`
  );

  if (total !== 30) {
    console.warn(
      `[Clone WebBrain] Warning: expected 30 documents in "${COLLECTION}", found ${total}. ` +
        'Check for tasks outside day 1-30.'
    );
  }

  await mongoose.disconnect();
  console.log('[Clone WebBrain] Done.');
}

main().catch(async (err) => {
  console.error('[Clone WebBrain] Seed failed:', err && err.message ? err.message : err);
  try {
    await mongoose.disconnect();
  } catch (_err) {
    /* ignore */
  }
  process.exit(1);
});
