import { pool } from './pool.js';

await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE,
  first_name TEXT,
  username TEXT,
  phone TEXT,
  goal TEXT,
  level TEXT,
  attended BOOLEAN DEFAULT NULL,
  clicked_recording BOOLEAN DEFAULT FALSE,
  current_stage TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
`);

// Zoom + funnel columns. Idempotent: safe to run repeatedly. goal/level/
// current_stage already exist on older databases; ADD COLUMN IF NOT EXISTS is a
// no-op for those. The Zoom registry now lives here (no more in-memory Map), so
// attendance reconciliation survives restarts, deploys and crashes.
await pool.query(`
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS goal TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_stage TEXT DEFAULT 'new';
ALTER TABLE users ADD COLUMN IF NOT EXISTS zoom_registrant_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zoom_join_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zoom_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zoom_attendance_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zoom_join_time TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zoom_leave_time TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zoom_duration_minutes NUMERIC;
ALTER TABLE users ADD COLUMN IF NOT EXISTS follow_up_segment TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS follow_up_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_zoom_registrant_id ON users (zoom_registrant_id);
`);

console.log('Migrations completed');
await pool.end();
