import { pool } from './pool.js';

function emptyToNull(value) {
  return value === '' || value === undefined ? null : value;
}

function mapRegistrantRow(row) {
  return {
    telegramId: String(row.telegram_id),
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    username: row.username || '',
    email: row.zoom_email || '',
    registrantId: row.zoom_registrant_id || '',
    joinUrl: row.zoom_join_url || '',
    followUpSegment: row.follow_up_segment || '',
    followUpSentAt: row.follow_up_sent_at || ''
  };
}

export async function upsertTelegramUser(ctx) {
  const tg = ctx.from;
  // `inserted` (via xmax = 0) is true only when this call actually created the
  // row, false when it hit an existing one. Used to make /start idempotent.
  const result = await pool.query(
    `INSERT INTO users (telegram_id, first_name, last_name, username, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (telegram_id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       username = EXCLUDED.username,
       updated_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [tg.id, tg.first_name || '', tg.last_name || '', tg.username || '']
  );
  return result.rows[0];
}

// --- Zoom registrant persistence (replaces the old in-memory Map) ---

export async function getZoomRegistrantByTelegramId(telegramId) {
  const result = await pool.query(
    `SELECT * FROM users
     WHERE telegram_id = $1 AND zoom_registrant_id IS NOT NULL AND zoom_registrant_id <> ''`,
    [telegramId]
  );
  return result.rows[0] ? mapRegistrantRow(result.rows[0]) : null;
}

export async function getAllZoomRegistrants() {
  const result = await pool.query(
    `SELECT * FROM users
     WHERE zoom_registrant_id IS NOT NULL AND zoom_registrant_id <> ''
     ORDER BY telegram_id`
  );
  return result.rows.map(mapRegistrantRow);
}

export async function upsertZoomRegistrant(telegramId, { registrantId, joinUrl, email, firstName, lastName, username }) {
  const result = await pool.query(
    `INSERT INTO users (telegram_id, first_name, last_name, username, zoom_registrant_id, zoom_join_url, zoom_email, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (telegram_id) DO UPDATE SET
       first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name),
       last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), users.last_name),
       username = COALESCE(NULLIF(EXCLUDED.username, ''), users.username),
       zoom_registrant_id = EXCLUDED.zoom_registrant_id,
       zoom_join_url = EXCLUDED.zoom_join_url,
       zoom_email = EXCLUDED.zoom_email,
       updated_at = now()
     RETURNING *`,
    [telegramId, firstName || '', lastName || '', username || '', registrantId || '', joinUrl || '', email || '']
  );
  return mapRegistrantRow(result.rows[0]);
}

export async function updateZoomAttendance(telegramId, { attendanceStatus, joinTime, leaveTime, durationMinutes }) {
  const result = await pool.query(
    `UPDATE users SET
       zoom_attendance_status = $2,
       zoom_join_time = $3,
       zoom_leave_time = $4,
       zoom_duration_minutes = $5,
       attended = $6,
       updated_at = now()
     WHERE telegram_id = $1
     RETURNING *`,
    [telegramId, attendanceStatus || '', emptyToNull(joinTime), emptyToNull(leaveTime), durationMinutes ?? null, attendanceStatus === 'attended']
  );
  return result.rows[0];
}

// Atomically claim the follow-up for a user. Returns a row only if it was NOT
// already claimed (follow_up_sent_at was NULL), so callers schedule the follow-up
// exactly once even if /sync_zoom_attendance is run repeatedly or concurrently.
export async function claimFollowUp(telegramId, segment) {
  const result = await pool.query(
    `UPDATE users SET follow_up_segment = $2, follow_up_sent_at = now()
     WHERE telegram_id = $1 AND follow_up_sent_at IS NULL
     RETURNING follow_up_sent_at`,
    [telegramId, segment]
  );
  return result.rows[0] || null;
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
