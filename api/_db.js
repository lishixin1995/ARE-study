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
    throw new Error("Cloud database is not configured.");
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
      division TEXT,
      room_id TEXT,
      room_name TEXT,
      subroom_id TEXT,
      subroom_name TEXT,
      topic_path TEXT,
      image_preview TEXT,
      ocr_text TEXT,
      edited_text TEXT NOT NULL,
      notes_text TEXT,
      analysis_source_text TEXT,
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

  await pool.query(`
    ALTER TABLE wrong_question_flashcards
      ADD COLUMN IF NOT EXISTS division TEXT,
      ADD COLUMN IF NOT EXISTS room_id TEXT,
      ADD COLUMN IF NOT EXISTS room_name TEXT,
      ADD COLUMN IF NOT EXISTS subroom_id TEXT,
      ADD COLUMN IF NOT EXISTS subroom_name TEXT,
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS notes_text TEXT,
      ADD COLUMN IF NOT EXISTS analysis_source_text TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_cloud_data (
      app_key TEXT NOT NULL,
      data_key TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT 'null'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (app_key, data_key)
    );
  `);
}
