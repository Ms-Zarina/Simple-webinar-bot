// Content loader for the webinar bot.
//
// TEMPLATE USAGE: a non-technical team member edits ONLY src/content/ru.json
// (texts, links, button labels, webinar date/time) and replaces the images in
// src/assets/. They never need to open this file or any bot logic.
//
// This module:
//   1. loads and parses src/content/ru.json;
//   2. fills empty fields from .env as a fallback (so old .env setups keep working);
//   3. validates that the required content is present and fails clearly at startup;
//   4. exposes getContent() plus a {{placeholder}} interpolation helper;
//   5. builds a `content` object with the exact API the bot/scheduler already use,
//      so no business logic (handlers, scheduling, Zoom, Sheets, DB, queue) changes.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const CONTENT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTENT_FILE = join(CONTENT_DIR, 'ru.json');

// ---------------------------------------------------------------------------
// 1. Load + parse JSON (fail clearly).
// ---------------------------------------------------------------------------
function loadRawContent() {
  let text;
  try {
    text = readFileSync(CONTENT_FILE, 'utf8');
  } catch (error) {
    throw new Error(`[content] cannot read ${CONTENT_FILE}: ${error.message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`[content] ${CONTENT_FILE} is not valid JSON: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// 2. env fallback: JSON wins, env fills the gaps, so JSON is the source of truth
//    but an unedited field still works from the existing .env.
// ---------------------------------------------------------------------------
function pick(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? '';
}

function resolveContent(raw) {
  const webinar = raw.webinar || {};
  const leadMagnet = raw.leadMagnet || {};
  const diagnostics = raw.diagnostics || {};
  const groupCourse = raw.groupCourse || {};
  const manager = raw.manager || {};
  const links = raw.links || {};

  return {
    ...raw,
    webinar: {
      ...webinar,
      title: pick(webinar.title, env.WEBINAR_TITLE),
      date: pick(webinar.date, env.WEBINAR_DATE),
      time: pick(webinar.time, env.WEBINAR_TIME),
      timezone: pick(webinar.timezone, env.WEBINAR_TIMEZONE, 'Europe/Prague'),
      zoomUrl: pick(webinar.zoomUrl, env.ZOOM_LINK),
      recordingUrl: pick(webinar.recordingUrl, env.WEBINAR_RECORDING_URL)
    },
    leadMagnet: {
      ...leadMagnet,
      pdfUrl: pick(leadMagnet.pdfUrl, env.PDF_GIFT_URL)
    },
    diagnostics: {
      ...diagnostics,
      url: pick(diagnostics.url, env.DIAGNOSTIC_LINK)
    },
    groupCourse: {
      ...groupCourse,
      url: pick(groupCourse.url, env.GROUP_LINK)
    },
    manager: {
      ...manager,
      username: pick(manager.username, env.MANAGER_USERNAME, '@manager')
    },
    links: {
      ...links,
      audio: pick(links.audio, env.AUDIO_URL),
      materials: pick(links.materials, env.WEBINAR_MATERIALS_URL),
      trial: pick(links.trial, env.TRIAL_LESSON_LINK)
    }
  };
}

// ---------------------------------------------------------------------------
// 3. Validation: collect every missing required field, then throw one error.
// ---------------------------------------------------------------------------
function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

const REQUIRED_STRINGS = [
  'webinar.title',
  'webinar.date',
  'webinar.time',
  'webinar.timezone',
  'webinar.zoomUrl',
  'webinar.recordingUrl',
  'leadMagnet.pdfUrl',
  'diagnostics.url',
  'groupCourse.url',
  'manager.username',
  'menu.title',
  'questions.goal.question',
  'questions.level.question',
  'messages.registrationWelcome',
  'messages.registrationSuccess',
  'messages.registrationRepeat',
  'messages.giftMessage',
  'messages.afterLevel',
  'messages.finalOffer',
  'messages.noShowFollowUp'
];

const REQUIRED_ARRAYS = [
  'menu.rows',
  'questions.goal.options',
  'questions.level.options',
  'messages.warmup',
  'messages.followUp'
];

const REQUIRED_OBJECTS = ['assets', 'buttons', 'callbacks', 'commands', 'zoom', 'admin', 'messages.reminders'];

function validateContent(data) {
  const errors = [];

  for (const path of REQUIRED_STRINGS) {
    const value = getPath(data, path);
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`missing or empty string: ${path}`);
    }
  }

  for (const path of REQUIRED_ARRAYS) {
    const value = getPath(data, path);
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`missing or empty array: ${path}`);
    }
  }

  for (const path of REQUIRED_OBJECTS) {
    const value = getPath(data, path);
    if (!value || typeof value !== 'object') {
      errors.push(`missing object: ${path}`);
    }
  }

  for (const name of Object.keys(data.assets || {})) {
    if (!data.assets[name]) errors.push(`missing or empty asset filename: assets.${name}`);
  }

  if (errors.length) {
    throw new Error(
      `[content] ${CONTENT_FILE} is invalid — fix these fields:\n  - ${errors.join('\n  - ')}`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Interpolation: replace {{a.b.c}} placeholders from the content + runtime ctx.
//    Unresolved placeholders are left visible and logged (never crash).
// ---------------------------------------------------------------------------
function interpolate(template, context) {
  if (typeof template !== 'string') return template;

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
    const value = getPath(context, path);
    if (value === undefined || value === null || value === '') {
      console.warn(`[content] unresolved placeholder ${match}`);
      return match;
    }
    return String(value);
  });
}

// ---------------------------------------------------------------------------
// 5. Build the `content` object. The shape mirrors what the bot/scheduler
//    already call, so handler/scheduling logic is untouched.
// ---------------------------------------------------------------------------
const data = resolveContent(loadRawContent());
validateContent(data);

// Base interpolation context: the resolved content sections. Per-call runtime
// values (user, zoom) are merged on top when rendering.
const baseContext = {
  webinar: data.webinar,
  leadMagnet: data.leadMagnet,
  diagnostics: data.diagnostics,
  groupCourse: data.groupCourse,
  manager: data.manager,
  links: data.links
};

// Whole days from today until the webinar date (>= 0). Computed at render time
// (which is when a message is scheduled), so {{webinar.daysLeft}} is current.
function daysUntilWebinar() {
  const parts = String(data.webinar.date).split('-').map(Number);
  const [year, month, day] = parts;
  if (!year || !month || !day) return '';

  const webinarUtc = Date.UTC(year, month - 1, day);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = Math.round((webinarUtc - todayUtc) / (24 * 60 * 60 * 1000));
  return diff > 0 ? diff : 0;
}

function render(template, runtime = {}) {
  const webinar = { ...baseContext.webinar, daysLeft: daysUntilWebinar() };
  return interpolate(template, { ...baseContext, webinar, ...runtime });
}

const goalOptions = data.questions.goal.options;
const levelOptions = data.questions.level.options;

function inlineKeyboard(prefix, options) {
  return {
    reply_markup: {
      inline_keyboard: options.map((opt) => [{ text: opt.label, callback_data: `${prefix}:${opt.key}` }])
    }
  };
}

export const content = {
  locale: data.locale || 'ru',

  webinar: data.webinar,
  links: data.links,
  leadMagnet: data.leadMagnet,
  diagnostics: data.diagnostics,
  groupCourse: data.groupCourse,
  manager: data.manager,
  buttons: data.buttons,
  questions: data.questions,
  assets: data.assets,

  // Reusable student cases / testimonials. All data lives in ru.json (cases[])
  // and is assigned to funnel slots in ru.json (caseUsage) — no hardcoded names
  // or image filenames in code. Images live in src/assets/cases/.
  cases: data.cases || [],
  caseUsage: data.caseUsage || {},
  getCaseById: (id) => (data.cases || []).find((c) => String(c.id) === String(id)) || null,
  renderCase: (caseId) => {
    const c = (data.cases || []).find((x) => String(x.id) === String(caseId));
    if (!c) {
      console.warn(`[content] case not found: id=${caseId}`);
      return '';
    }
    const text = [
      `📌 ${c.title || ''}`,
      '',
      `👤 ${c.name || ''}`,
      '',
      'Проблема:',
      c.problem || '',
      '',
      'Что помогло:',
      c.solution || '',
      '',
      'Результат:',
      c.result || '',
      '',
      `💬 "${c.quote || ''}"`
    ].join('\n');
    return render(text);
  },
  // Photo descriptor for the scheduler/queue (text-with-photo, text-only fallback).
  getCaseMedia: (caseId) => {
    const c = (data.cases || []).find((x) => String(x.id) === String(caseId));
    return c && c.image ? { asset: c.image, kind: 'photo' } : null;
  },

  // Local media files (in src/assets) that are sent through the scheduler/queue,
  // not just by command handlers. Each descriptor is passed to scheduleMessage as
  // `media`; the queue worker sends the file if present, else the text fallback.
  // Swappable: drop a new file with the same name into src/assets — no code change.
  media: {
    giftPdf: { asset: data.assets.giftPdf, kind: 'document' },
    lecturerVoice: { asset: data.assets.lecturerVoice, kind: 'voice' }
  },

  menu: {
    title: data.menu.title,
    keyboard: data.menu.rows
  },

  // Inline-option labels and keyboards (questions.goal / questions.level).
  goalLabel: (key) => goalOptions.find((o) => o.key === key)?.label || key,
  levelLabel: (key) => levelOptions.find((o) => o.key === key)?.label || key,
  keyboards: {
    goalInline: () => inlineKeyboard('goal', goalOptions),
    levelInline: () => inlineKeyboard('level', levelOptions)
  },

  common: {
    webinarLine: () => `"${data.webinar.title}"\nДата: ${data.webinar.date} в ${data.webinar.time} по Праге`
  },

  // Immediate command replies.
  commands: {
    start: {
      firstTime: () => render(data.messages.registrationSuccess),
      repeat: () => render(data.messages.registrationRepeat)
    },
    webinar: () => render(data.commands.webinar),
    gift: () => render(data.commands.gift),
    diagnostic: () => render(data.commands.diagnostic),
    trial: () => render(data.commands.trial),
    group: () => render(data.commands.group),
    recording: () => render(data.commands.recording),
    manager: () => render(data.commands.manager),
    testSheetsOk: data.commands.testSheetsOk,
    testSheetsFail: data.commands.testSheetsFail
  },

  callbacks: data.callbacks,

  // Admin-facing replies + one-click panel for the live offer broadcast (/send_offer).
  admin: {
    offerPrompt: (count) => render(data.admin.offerPrompt, { offer: { count } }),
    offerButton: data.admin.offerButton,
    offerCancel: data.admin.offerCancel,
    offerCancelled: data.admin.offerCancelled,
    offerSending: data.admin.offerSending,
    offerSent: (count) => render(data.admin.offerSent, { offer: { count } }),
    offerNoRecipients: data.admin.offerNoRecipients,
    notAdmin: data.admin.notAdmin,
    dbRequired: data.admin.dbRequired,
    adminsNotConfigured: data.admin.adminsNotConfigured,
    // Inline keyboard with the one-click "send offer" + cancel buttons.
    offerKeyboard: () => ({
      reply_markup: {
        inline_keyboard: [
          [{ text: data.admin.offerButton, callback_data: 'offer:send' }],
          [{ text: data.admin.offerCancel, callback_data: 'offer:cancel' }]
        ]
      }
    })
  },

  zoom: {
    personalLink: (url) => render(data.zoom.personalLink, { zoom: { joinUrl: url } }),
    disabled: data.zoom.disabled,
    missingEnv: (missing) => render(data.zoom.missingEnv, { zoom: { missing: missing.join(', ') } }),
    statusOk: (cfg) => render(data.zoom.statusOk, { zoom: cfg }),
    statusTokenError: (message) => render(data.zoom.statusTokenError, { zoom: { message } }),
    registerNoJoinUrl: (registrantId) => render(data.zoom.registerNoJoinUrl, { zoom: { registrantId } }),
    registerError: (message) => render(data.zoom.registerError, { zoom: { message } }),
    attendanceDbRequired: data.zoom.attendanceDbRequired,
    attendanceError: (message) => render(data.zoom.attendanceError, { zoom: { message } }),
    attendanceSummary: ({ participants, classified, counts, followUpsScheduled, synced }) =>
      render(data.zoom.attendanceSummary, {
        zoom: {
          participants,
          classified,
          attended: counts.attended,
          attendedShort: counts.attended_short,
          noShow: counts.no_show,
          followUpsScheduled,
          synced
        }
      })
  },

  // Funnel drip messages — shapes match what flows/scheduler.js consumes.
  messages: {
    welcome: {
      confirm: () => render(data.messages.registrationWelcome),
      gift: () => render(data.messages.giftMessage),
      goal: () => render(data.questions.goal.question),
      level: () => render(data.messages.afterGoal),
      final: () => render(data.messages.afterLevel)
    },
    warmup: data.messages.warmup.map((template) => () => render(template)),
    live: {
      morning: () => render(data.messages.reminders.morningOfWebinar),
      minus3h: () => render(data.messages.reminders.threeHoursBefore),
      minus15m: () => render(data.messages.reminders.fifteenMinutesBefore),
      minus2m: () => render(data.messages.reminders.twoMinutesBefore),
      plus10m: () => render(data.messages.reminders.afterStart),
      plus30m: () => render(data.messages.reminders.inProgress),
      offer: () => render(data.messages.finalOffer)
    },
    follow: data.messages.followUp.map((template) => () => render(template)),
    noShow: () => render(data.messages.noShowFollowUp),
    attendedShort: () => render(data.messages.attendedShortFollowUp)
  }
};

export function getContent() {
  return content;
}

// Exposed for tests / advanced use.
export { render, interpolate };

export default content;
