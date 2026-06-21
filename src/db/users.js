import { pool } from './pool.js';

export async function upsertTelegramUser(ctx) {
  const tg = ctx.from;
  const result = await pool.query(
    `INSERT INTO users (telegram_id, first_name, username, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (telegram_id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       username = EXCLUDED.username,
       updated_at = now()
     RETURNING *`,
    [tg.id, tg.first_name || '', tg.username || '']
  );
  return result.rows[0];
}

export async function updateUserByTelegramId(telegramId, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return null;
  const sets = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
  const values = keys.map((key) => patch[key]);
  const result = await pool.query(
    `UPDATE users SET ${sets}, updated_at = now() WHERE telegram_id = $1 RETURNING *`,
    [telegramId, ...values]
  );
  return result.rows[0];
}

export async function getUserByTelegramId(telegramId) {
  const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  return result.rows[0];
}

export async function getAllUsers() {
  const result = await pool.query('SELECT * FROM users WHERE telegram_id IS NOT NULL ORDER BY created_at DESC');
  return result.rows;
}
