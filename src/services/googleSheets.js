import { env } from '../config/env.js';
import { content } from '../content/loadContent.js';

const source = 'telegram_webinar_bot';
let skipLogged = false;

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    const suffix = parsed.pathname.split('/').filter(Boolean).slice(-1)[0] || '';
    return `${parsed.origin}/.../${suffix}`;
  } catch {
    return '<invalid url>';
  }
}

export function logGoogleSheetsConfig() {
  if (env.GOOGLE_SHEETS_WEBHOOK_URL) {
    console.log(`[google-sheets] webhook URL configured: ${maskUrl(env.GOOGLE_SHEETS_WEBHOOK_URL)}`);
  } else {
    console.log('[google-sheets] webhook URL not configured; lead sync disabled');
  }
}

function asIso(value, fallback) {
  if (!value) return fallback.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

export function buildLeadPayload({ ctx, event = 'lead_updated', user = null, goal = '', level = '', stage = '', zoom = {}, followUp = {} }) {
  const now = new Date();
  const from = ctx.from || {};

  return {
    source,
    event,
    telegramId: String(from.id || user?.telegram_id || ''),
    telegramUsername: from.username || user?.username || '',
    firstName: from.first_name || user?.first_name || '',
    lastName: from.last_name || user?.last_name || '',
    goal: goal || user?.goal || '',
    level: level || user?.level || '',
    stage: stage || user?.current_stage || 'new',
    webinarTitle: content.webinar.title,
    webinarDate: content.webinar.date,
    createdAt: asIso(user?.created_at, now),
    updatedAt: asIso(user?.updated_at, now),
    zoomRegistrantId: zoom.registrantId || user?.zoom_registrant_id || '',
    zoomJoinUrl: zoom.joinUrl || user?.zoom_join_url || '',
    zoomAttendanceStatus: zoom.attendanceStatus || '',
    zoomJoinTime: zoom.joinTime || '',
    zoomLeaveTime: zoom.leaveTime || '',
    zoomDurationMinutes: zoom.durationMinutes ?? '',
    followUpSegment: followUp.segment || '',
    followUpSentAt: followUp.sentAt || ''
  };
}

export async function sendLeadToGoogleSheets(payload) {
  if (!env.GOOGLE_SHEETS_WEBHOOK_URL) {
    if (!skipLogged) {
      console.log('[google-sheets] GOOGLE_SHEETS_WEBHOOK_URL is empty; lead sync skipped');
      skipLogged = true;
    }
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.GOOGLE_SHEETS_TIMEOUT_MS);

  try {
    console.log(`[google-sheets] sending ${payload.event} for telegramId=${payload.telegramId}`);

    const response = await fetch(env.GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const responseText = await response.text();

    if (!response.ok) {
      console.warn(`[google-sheets] error response HTTP ${response.status}: ${responseText}`);
      return false;
    }

    console.log(`[google-sheets] success response HTTP ${response.status}: ${responseText}`);
    return true;
  } catch (error) {
    console.warn(`[google-sheets] lead sync failed for telegramId=${payload.telegramId}: ${error.message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
