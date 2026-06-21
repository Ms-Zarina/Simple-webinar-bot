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

console.log('Migrations completed');
await pool.end();
