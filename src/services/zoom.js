import { env } from '../config/env.js';

const OAUTH_URL = 'https://zoom.us/oauth/token';
const API_BASE = 'https://api.zoom.us/v2';

// Only the OAuth token is cached in memory (cheap to refetch after a restart).
// Registrants are NOT kept in memory anymore — they are persisted in PostgreSQL
// (see src/db/users.js) so attendance reconciliation survives restarts, deploys
// and crashes. This module is a pure Zoom API client; the DB is the registry.
let tokenCache = { accessToken: null, expiresAt: 0 };

function requiredConfig() {
  return {
    ZOOM_ACCOUNT_ID: env.ZOOM_ACCOUNT_ID,
    ZOOM_CLIENT_ID: env.ZOOM_CLIENT_ID,
    ZOOM_CLIENT_SECRET: env.ZOOM_CLIENT_SECRET,
    ZOOM_MEETING_ID: env.ZOOM_MEETING_ID
  };
}

// Safe config summary for diagnostics: never exposes the client secret.
export function getZoomConfig() {
  const missing = Object.entries(requiredConfig())
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    enabled: env.ZOOM_ENABLED,
    meetingType: env.ZOOM_MEETING_TYPE,
    meetingId: env.ZOOM_MEETING_ID,
    attendanceMinutes: env.ZOOM_ATTENDANCE_MINUTES,
    hasAccountId: Boolean(env.ZOOM_ACCOUNT_ID),
    hasClientId: Boolean(env.ZOOM_CLIENT_ID),
    hasClientSecret: Boolean(env.ZOOM_CLIENT_SECRET),
    missing
  };
}

export function logZoomConfig() {
  if (!env.ZOOM_ENABLED) {
    console.log('[zoom] integration disabled (ZOOM_ENABLED=false)');
    return;
  }

  const cfg = getZoomConfig();
  // Deliberately never logs ZOOM_CLIENT_SECRET.
  console.log(
    `[zoom] enabled type=${cfg.meetingType} meetingId=${cfg.meetingId || '<empty>'} ` +
      `accountId=${cfg.hasAccountId ? 'set' : 'missing'} clientId=${cfg.hasClientId ? 'set' : 'missing'} ` +
      `clientSecret=${cfg.hasClientSecret ? 'set' : 'missing'} attendanceMinutes=${cfg.attendanceMinutes}`
  );

  if (cfg.missing.length) {
    console.warn(`[zoom] missing required config: ${cfg.missing.join(', ')}`);
  }
}

function meetingResource() {
  const type = env.ZOOM_MEETING_TYPE === 'webinar' ? 'webinars' : 'meetings';
  return { type, id: env.ZOOM_MEETING_ID };
}

function fallbackEmail(telegramId) {
  return `telegram_${telegramId}@example.com`;
}

// Server-to-Server OAuth: exchange account credentials for a short-lived token.
export async function getZoomAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = env;
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error('Zoom credentials are not configured (account id / client id / client secret)');
  }

  const basic = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
  const url = `${OAUTH_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`;

  // Never logs the Basic auth header (client id/secret) or the raw account id.
  console.log('[zoom] OAuth request -> POST zoom.us/oauth/token (grant=account_credentials)');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ZOOM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      signal: controller.signal
    });

    const data = await safeJson(response);
    if (!response.ok) {
      console.warn(`[zoom] OAuth response <- HTTP ${response.status}: ${truncate(data)}`);
      throw new Error(`Zoom OAuth HTTP ${response.status}: ${data.reason || data.error || 'unknown error'}`);
    }

    console.log(`[zoom] OAuth response <- HTTP ${response.status} (expires_in=${data.expires_in}s, scope="${truncate(data.scope, 120)}")`);

    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
    };
    return tokenCache.accessToken;
  } finally {
    clearTimeout(timeout);
  }
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function truncate(value, max = 400) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…(${text.length} chars)` : text;
}

async function zoomApi(path, { method = 'GET', body } = {}) {
  const token = await getZoomAccessToken();
  console.log(`[zoom] request -> ${method} ${API_BASE}${path}${body ? ` body=${truncate(body)}` : ''}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ZOOM_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const data = await safeJson(response);
    console.log(`[zoom] response <- ${method} ${path} HTTP ${response.status}: ${truncate(data)}`);
    if (!response.ok) {
      throw new Error(`Zoom API ${method} ${path} -> HTTP ${response.status}: ${data.message || data.reason || data.raw || 'unknown error'}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// Fetch meeting/webinar metadata (topic, start time, settings). Useful for
// diagnostics and to confirm the configured ZOOM_MEETING_ID is reachable.
export async function getMeetingDetails() {
  const { type, id } = meetingResource();
  if (!id) throw new Error('ZOOM_MEETING_ID is not configured');
  return zoomApi(`/${type}/${id}`);
}

// Register a Telegram user as a meeting/webinar registrant and return their
// personal join URL. Pure API call — persistence is the caller's job (the bot
// writes the result to PostgreSQL via upsertZoomRegistrant).
export async function registerMeetingRegistrant(user) {
  const { type, id } = meetingResource();
  if (!id) throw new Error('ZOOM_MEETING_ID is not configured');

  const telegramId = String(user.telegramId);
  const email = user.email || fallbackEmail(telegramId);

  const data = await zoomApi(`/${type}/${id}/registrants`, {
    method: 'POST',
    body: {
      email,
      first_name: user.firstName || 'Telegram',
      last_name: user.lastName || telegramId
    }
  });

  return {
    telegramId,
    email,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    username: user.username || '',
    registrantId: String(data.registrant_id || data.id || ''),
    joinUrl: data.join_url || ''
  };
}

function normalizeParticipant(participant) {
  return {
    // registrant_id is present in the report when the meeting requires
    // registration; it is the reliable join key (see classifyAttendance).
    registrantId: String(participant.registrant_id || ''),
    name: participant.name || '',
    email: (participant.user_email || '').toLowerCase(),
    durationMinutes: Math.round(((Number(participant.duration) || 0) / 60) * 100) / 100,
    joinTime: participant.join_time || '',
    leaveTime: participant.leave_time || ''
  };
}

// Fetch the full (paginated) participant report for the configured meeting.
// Note: the Zoom report endpoints only return data for meetings that have
// already ended and require a paid plan with report:read:admin scope.
export async function getMeetingParticipantsReport() {
  const { type, id } = meetingResource();
  if (!id) throw new Error('ZOOM_MEETING_ID is not configured');

  const participants = [];
  let nextPageToken = '';

  do {
    const query = new URLSearchParams({ page_size: '300' });
    if (nextPageToken) query.set('next_page_token', nextPageToken);

    const data = await zoomApi(`/report/${type}/${id}/participants?${query.toString()}`);
    for (const participant of data.participants || []) {
      participants.push(normalizeParticipant(participant));
    }
    nextPageToken = data.next_page_token || '';
  } while (nextPageToken);

  return participants;
}

// Aggregates participant sessions (a person may join/leave several times) and
// returns three lookup indexes so a registrant can be matched by the most
// reliable key available: registrant_id first, then email, then display name.
function aggregateParticipants(participants) {
  const sessions = new Map();
  for (const participant of participants) {
    const key =
      (participant.registrantId && `rid:${participant.registrantId}`) ||
      (participant.email && `email:${participant.email}`) ||
      (participant.name && `name:${participant.name.toLowerCase()}`);
    if (!key) continue;

    const current = sessions.get(key) || {
      registrantId: participant.registrantId,
      email: participant.email,
      name: participant.name,
      durationMinutes: 0,
      joinTime: '',
      leaveTime: ''
    };

    current.durationMinutes += participant.durationMinutes;
    if (participant.joinTime && (!current.joinTime || participant.joinTime < current.joinTime)) {
      current.joinTime = participant.joinTime;
    }
    if (participant.leaveTime && (!current.leaveTime || participant.leaveTime > current.leaveTime)) {
      current.leaveTime = participant.leaveTime;
    }
    sessions.set(key, current);
  }

  const byRegistrantId = new Map();
  const byEmail = new Map();
  const byName = new Map();
  for (const session of sessions.values()) {
    if (session.registrantId) byRegistrantId.set(String(session.registrantId), session);
    if (session.email) byEmail.set(session.email.toLowerCase(), session);
    if (session.name) byName.set(session.name.trim().toLowerCase(), session);
  }
  return { byRegistrantId, byEmail, byName };
}

function statusFor(durationMinutes) {
  if (durationMinutes >= env.ZOOM_ATTENDANCE_MINUTES) return 'attended';
  if (durationMinutes > 0) return 'attended_short';
  return 'no_show';
}

// Reconcile registrants (loaded from PostgreSQL) against the participant report.
//   attended       -> duration >= ZOOM_ATTENDANCE_MINUTES
//   attended_short -> 0 < duration < ZOOM_ATTENDANCE_MINUTES
//   no_show        -> registered but never appeared in the report
// Matching key: registrant_id (primary) -> email -> name (fallbacks).
export function classifyAttendance({ participants = [], registrants = [] } = {}) {
  const { byRegistrantId, byEmail, byName } = aggregateParticipants(participants);

  return registrants.map((person) => {
    const registrantId = person.registrantId ? String(person.registrantId) : '';
    const emailKey = (person.email || '').toLowerCase();
    const nameKey = `${person.firstName || ''} ${person.lastName || ''}`.trim().toLowerCase();

    let match = null;
    let matchedBy = 'none';
    if (registrantId && byRegistrantId.has(registrantId)) {
      match = byRegistrantId.get(registrantId);
      matchedBy = 'registrant_id';
    } else if (emailKey && byEmail.has(emailKey)) {
      match = byEmail.get(emailKey);
      matchedBy = 'email';
    } else if (nameKey && byName.has(nameKey)) {
      match = byName.get(nameKey);
      matchedBy = 'name';
    }

    const durationMinutes = match ? match.durationMinutes : 0;

    return {
      telegramId: person.telegramId,
      email: person.email,
      registrantId,
      joinUrl: person.joinUrl || '',
      firstName: person.firstName || '',
      lastName: person.lastName || '',
      username: person.username || '',
      followUpSentAt: person.followUpSentAt || '',
      status: statusFor(durationMinutes),
      durationMinutes,
      joinTime: match ? match.joinTime : '',
      leaveTime: match ? match.leaveTime : '',
      matchedBy
    };
  });
}
