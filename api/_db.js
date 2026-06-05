import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL;

const hasDatabase = Boolean(connectionString);
const globalForDb = globalThis;

export const pool = hasDatabase
  ? globalForDb.__studyVaultPool ||
    new Pool({
      connectionString,
      ssl: connectionString.includes("localhost")
        ? false
        : { rejectUnauthorized: false }
    })
  : null;

if (pool && !globalForDb.__studyVaultPool) {
  globalForDb.__studyVaultPool = pool;
}

export async function ensureTables() {
  if (!pool) {
    throw new Error("Cloud database is not configured. The app can still use local browser storage.");
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS study_rooms (
      id TEXT PRIMARY KEY,
      division TEXT NOT NULL,
      parent_id TEXT,
      room_name TEXT NOT NULL,
      room_type TEXT NOT NULL CHECK (room_type IN ('room', 'subroom')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS study_notes (
      id TEXT PRIMARY KEY,
      division TEXT NOT NULL,
      room_id TEXT NOT NULL,
      room_name TEXT,
      subroom_id TEXT,
      subroom_name TEXT,
      note_text TEXT NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wrong_question_flashcards (
      id TEXT PRIMARY KEY,
      topic_path TEXT,
      image_preview TEXT,
      ocr_text TEXT,
      edited_text TEXT NOT NULL,
      question_text TEXT,
      summary TEXT,
      correct_answer JSONB,
      answer_extraction JSONB NOT NULL DEFAULT '[]'::jsonb,
      bullet_points JSONB NOT NULL DEFAULT '[]'::jsonb,
      trap_point JSONB NOT NULL DEFAULT '[]'::jsonb,
      memory_hook TEXT,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
