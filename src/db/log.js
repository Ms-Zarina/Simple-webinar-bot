import { pool } from './pool.js';

export async function logEvent(userId, eventType, payload = {}) {
  await pool.query(
    'INSERT INTO events_log (user_id, event_type, payload) VALUES ($1, $2, $3)',
    [userId, eventType, payload]
  );
}
