import { Telegraf, Markup } from 'telegraf';
import { env } from '../config/env.js';
import {
  upsertTelegramUser,
  updateUserByTelegramId,
  getZoomRegistrantByTelegramId,
  upsertZoomRegistrant,
  getAllZoomRegistrants,
  updateZoomAttendance,
  claimFollowUp,
  getAllUsers
} from '../db/users.js';
import { broadcastNow } from '../queue/queue.js';
import {
  startWelcomeFlow,
  scheduleWarmup,
  scheduleLiveDay,
  scheduleFollowUp,
  scheduleNoShow
} from '../flows/scheduler.js';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { content } from '../content/loadContent.js';
import { buildLeadPayload, sendLeadToGoogleSheets } from '../services/googleSheets.js';
import {
  getZoomConfig,
  getZoomAccessToken,
  registerMeetingRegistrant,
  getMeetingParticipantsReport,
  classifyAttendance
} from '../services/zoom.js';

export const bot = new Telegraf(env.BOT_TOKEN);

const leadState = new Map();

// Telegram IDs allowed to run admin commands (/send_offer). Parsed once from
// ADMIN_TELEGRAM_IDS (comma-separated). Empty set = admin broadcast disabled.
const adminIds = new Set(
  env.ADMIN_TELEGRAM_IDS.split(',').map((id) => id.trim()).filter(Boolean)
);

function isAdmin(ctx) {
  return adminIds.has(String(ctx.from?.id || ''));
}

// All user-facing labels live in src/content/ru.js now (content.buttons / .goalLabel / .levelLabel).

bot.catch((error, ctx) => {
  console.error(`[bot] Telegraf handler FAILED update=${ctx?.update?.update_id} type=${ctx?.updateType}: ${error.message}`);
  if (error?.stack) console.error(error.stack);
});

// Diagnostics only (no business logic): logs every update that reaches Telegraf,
// wraps ctx.reply to log sent/failed, and records whether the handler chain
// completed or threw. If a button is pressed and NO "[bot] update entered" line
// appears, the update never reached the bot (webhook/ngrok delivery problem),
// not a handler problem.
bot.use(async (ctx, next) => {
  const updateId = ctx.update?.update_id;
  const text = ctx.message?.text;
  const data = ctx.callbackQuery?.data;
  console.log(
    `[bot] update entered id=${updateId} type=${ctx.updateType}` +
      (text ? ` text="${text}"` : '') +
      (data ? ` data="${data}"` : '')
  );

  const originalReply = ctx.reply.bind(ctx);
  ctx.reply = async (...args) => {
    try {
      const result = await originalReply(...args);
      console.log(`[bot] reply sent id=${updateId}`);
      return result;
    } catch (error) {
      console.error(`[bot] reply FAILED id=${updateId}: ${error.message}`);
      throw error;
    }
  };

  try {
    await next();
    console.log(`[bot] update handled id=${updateId}`);
  } catch (error) {
    console.error(`[bot] update handler threw id=${updateId}: ${error.message}`);
    throw error;
  }
});

bot.on('callback_query', async (ctx, next) => {
  const callbackData = ctx.callbackQuery?.data || '';
  const telegramId = ctx.from?.id || 'unknown';
  console.log(`[bot] callback_query received telegramId=${telegramId} data="${callbackData}"`);
  return next();
});

// Acknowledging a callback only clears the button spinner. It must never block
// the actual reply: an expired/old query (e.g. delivered late after a downtime)
// makes answerCbQuery throw, which would otherwise abort the handler before reply.
async function safeAnswerCb(ctx, text) {
  try {
    await ctx.answerCbQuery(text);
  } catch (error) {
    console.warn(`[bot] answerCbQuery failed telegramId=${ctx.from?.id || 'unknown'}: ${error.message}`);
  }
}

async function tryDb(action, description) {
  if (!env.DATABASE_ENABLED) {
    console.log(`[db] ${description} skipped: DATABASE_ENABLED=false`);
    return null;
  }

  try {
    return await action();
  } catch (error) {
    console.warn(`[db] ${description} skipped: ${error.message}`);
    return null;
  }
}

// Local images live in src/assets/. Filenames come from the content file
// (content.assets). If an image is missing, the bot logs a warning and sends the
// caption as a plain text message instead — it never crashes.
const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '../assets');

async function replyWithAsset(ctx, assetFile, caption) {
  const filePath = assetFile ? join(assetsDir, assetFile) : '';
  if (filePath && existsSync(filePath)) {
    try {
      return await ctx.replyWithPhoto({ source: filePath }, { caption });
    } catch (error) {
      console.warn(`[assets] failed to send ${assetFile}: ${error.message}; falling back to text`);
    }
  } else if (assetFile) {
    console.warn(`[assets] image not found: ${assetFile}; sending text only`);
  }
  return ctx.reply(caption);
}

// Sends a local file from src/assets as a Telegram document (e.g. the gift PDF).
// Returns true if the document was sent, false if the file is missing or failed
// (so the caller can fall back to an image/text). Never throws.
async function trySendDocument(ctx, assetFile, caption) {
  const filePath = assetFile ? join(assetsDir, assetFile) : '';
  if (filePath && existsSync(filePath)) {
    try {
      await ctx.replyWithDocument({ source: filePath }, { caption });
      return true;
    } catch (error) {
      console.warn(`[assets] failed to send document ${assetFile}: ${error.message}; falling back`);
    }
  } else if (assetFile) {
    console.warn(`[assets] document not found: ${assetFile}; falling back`);
  }
  return false;
}

function menuKeyboard(ctx) {
  const rows = content.menu.keyboard.map((row) => [...row]);
  // Admins get an extra persistent button to launch the live offer broadcast.
  if (isAdmin(ctx)) {
    rows.push([content.admin.offerButton]);
  }
  return Markup.keyboard(rows).resize();
}

async function replyMainMenu(ctx) {
  await ctx.reply(content.menu.title, menuKeyboard(ctx));
}

function command(pattern, handler) {
  bot.hears(pattern, handler);
}

async function syncLead(ctx, { user = null, goal = undefined, level = undefined, stage = undefined, zoom = undefined } = {}) {
  const telegramId = ctx.from.id;
  console.log(`[google-sheets] syncLead triggered for telegramId=${telegramId}`);

  const previous = leadState.get(telegramId) || {};
  const next = {
    ...previous,
    ...(goal !== undefined ? { goal } : {}),
    ...(level !== undefined ? { level } : {}),
    ...(stage !== undefined ? { stage } : {}),
    ...(zoom !== undefined ? { zoom: { ...previous.zoom, ...zoom } } : {})
  };

  leadState.set(telegramId, next);

  const payload = buildLeadPayload({
    ctx,
    user,
    goal: next.goal,
    level: next.level,
    stage: next.stage || user?.current_stage || 'new',
    zoom: next.zoom || {}
  });

  console.log(`[google-sheets] syncLead payload prepared event=${payload.event} stage=${payload.stage} telegramId=${payload.telegramId}`);
  const sent = await sendLeadToGoogleSheets(payload);
  console.log(`[google-sheets] syncLead completed sent=${sent} telegramId=${telegramId}`);
  return sent;
}

function syncLeadInBackground(ctx, options, reason) {
  console.log(`[google-sheets] queue background sync reason=${reason} telegramId=${ctx.from.id}`);
  syncLead(ctx, options).catch((error) => {
    console.warn(`[google-sheets] background sync failed reason=${reason} telegramId=${ctx.from.id}: ${error.message}`);
  });
}

// Registers the (now qualified) user for the Zoom meeting, sends them their
// personal join URL, and syncs the Zoom fields to Google Sheets. Fully guarded:
// any failure here must never break the existing funnel/final message.
// Returns a status object so callers can react. The funnel calls it
// fire-and-forget (ignoring the result); the /zoom_register_me diagnostic uses
// the status to reply with a clear outcome.
async function registerZoomForUser(ctx) {
  if (!env.ZOOM_ENABLED) {
    console.log(`[zoom] registration skipped telegramId=${ctx.from.id}: ZOOM_ENABLED=false`);
    return { ok: false, reason: 'disabled' };
  }

  if (!env.DATABASE_ENABLED) {
    console.warn(`[zoom] registration skipped telegramId=${ctx.from.id}: requires DATABASE_ENABLED=true (registrants are persisted in PostgreSQL)`);
    return { ok: false, reason: 'db_disabled' };
  }

  const cfg = getZoomConfig();
  if (cfg.missing.length) {
    console.warn(`[zoom] registration skipped telegramId=${ctx.from.id}: missing ${cfg.missing.join(', ')}`);
    return { ok: false, reason: 'missing', missing: cfg.missing };
  }

  const telegramId = ctx.from.id;

  // Idempotency: if this user already has a Zoom registrant in the DB, reuse it.
  // Do NOT create a second registrant or a new join URL.
  try {
    const existing = await getZoomRegistrantByTelegramId(telegramId);
    if (existing && existing.registrantId) {
      console.log(`[zoom] already registered telegramId=${telegramId} registrantId=${existing.registrantId} (reusing existing join URL)`);
      if (existing.joinUrl) {
        await replyWithAsset(ctx, content.assets.registrationThankYou, content.zoom.personalLink(existing.joinUrl));
      }
      return { ok: true, reason: 'existing', registrantId: existing.registrantId, joinUrl: existing.joinUrl };
    }
  } catch (error) {
    console.warn(`[zoom] idempotency check failed telegramId=${telegramId}: ${error.message} (will attempt registration)`);
  }

  try {
    const from = ctx.from;
    const result = await registerMeetingRegistrant({
      telegramId: from.id,
      firstName: from.first_name || '',
      lastName: from.last_name || '',
      username: from.username || ''
    });

    // Persist the registrant in PostgreSQL so attendance sync survives restarts.
    await upsertZoomRegistrant(telegramId, {
      registrantId: result.registrantId,
      joinUrl: result.joinUrl,
      email: result.email,
      firstName: from.first_name || '',
      lastName: from.last_name || '',
      username: from.username || ''
    });
    console.log(`[zoom] registrant created+persisted telegramId=${telegramId} registrantId=${result.registrantId}`);

    if (result.joinUrl) {
      await replyWithAsset(ctx, content.assets.registrationThankYou, content.zoom.personalLink(result.joinUrl));
    }

    syncLeadInBackground(
      ctx,
      { stage: 'qualified', zoom: { registrantId: result.registrantId, joinUrl: result.joinUrl } },
      'zoom_registration'
    );
    return { ok: true, reason: 'registered', registrantId: result.registrantId, joinUrl: result.joinUrl };
  } catch (error) {
    console.warn(`[zoom] registration failed telegramId=${telegramId}: ${error.message}`);
    return { ok: false, reason: 'error', error: error.message };
  }
}

bot.start(async (ctx) => {
  console.log(`[bot] /start received from telegramId=${ctx.from.id}`);
  const user = await tryDb(() => upsertTelegramUser(ctx), 'upsert Telegram user');
  syncLeadInBackground(ctx, { user, stage: user?.current_stage || 'new' }, 'start');

  // Idempotency: schedule the drip (welcome/warmup/live-day) only the first time
  // the user row is created. `inserted` comes from the upsert (xmax = 0). A
  // repeat /start must not enqueue duplicate jobs. When DB is disabled, `user`
  // is null and we fall back to the legacy always-schedule behavior.
  const firstStart = user ? user.inserted === true : true;

  if (firstStart) {
    await ctx.reply(content.commands.start.firstTime(), menuKeyboard(ctx));
    await startWelcomeFlow(ctx.from.id);
    await scheduleWarmup(ctx.from.id);
    await scheduleLiveDay(ctx.from.id);
  } else {
    console.log(`[bot] /start repeat telegramId=${ctx.from.id} stage=${user?.current_stage} — drip NOT re-scheduled`);
    await ctx.reply(content.commands.start.repeat(), menuKeyboard(ctx));
  }
});

bot.command(['start', 'menu'], replyMainMenu);
command(/^\/(начало|меню)$/i, replyMainMenu);

const webinarHandler = (ctx) => replyWithAsset(ctx, content.assets.webinarCover, content.commands.webinar());
const giftHandler = async (ctx) => {
  // Prefer the real PDF (src/assets/gift.pdf); fall back to the cover image, then text.
  if (await trySendDocument(ctx, content.assets.giftPdf, content.commands.gift())) return;
  return replyWithAsset(ctx, content.assets.pdfCover, content.commands.gift());
};
const diagnosticHandler = (ctx) => replyWithAsset(ctx, content.assets.diagnosticsBanner, content.commands.diagnostic());
const trialHandler = (ctx) => ctx.reply(content.commands.trial());
const groupHandler = (ctx) => replyWithAsset(ctx, content.assets.groupCourseBanner, content.commands.group());
const recordingHandler = (ctx) => ctx.reply(content.commands.recording());
const managerHandler = (ctx) => {
  // Show the manager contact with a tappable button (link from ru.json) when available.
  const extra = content.manager.link
    ? { reply_markup: { inline_keyboard: [[{ text: content.manager.buttonText, url: content.manager.link }]] } }
    : {};
  return ctx.reply(content.commands.manager(), extra);
};

bot.command(['webinar'], webinarHandler);
bot.command(['gift'], giftHandler);
bot.command(['diagnostic'], diagnosticHandler);
bot.command(['trial'], trialHandler);
bot.command(['group'], groupHandler);
bot.command(['recording'], recordingHandler);
bot.command(['manager'], managerHandler);
// /help is referenced in the live offer message ("Напиши /help … менеджер ответит"),
// so it must show the manager contact, not the main menu.
bot.command(['help'], managerHandler);
bot.command(['test_sheets'], async (ctx) => {
  console.log(`[google-sheets] /test_sheets received from telegramId=${ctx.from.id}`);
  const payload = buildLeadPayload({
    ctx,
    event: 'test_sheets',
    stage: 'test'
  });
  const sent = await sendLeadToGoogleSheets(payload);
  await ctx.reply(sent ? content.commands.testSheetsOk : content.commands.testSheetsFail);
});

bot.command(['zoom_status'], async (ctx) => {
  console.log(`[zoom] /zoom_status received from telegramId=${ctx.from.id}`);
  const cfg = getZoomConfig();

  if (!cfg.enabled) {
    await ctx.reply(content.zoom.disabled);
    return;
  }

  if (cfg.missing.length) {
    await ctx.reply(content.zoom.missingEnv(cfg.missing));
    return;
  }

  try {
    await getZoomAccessToken();
  } catch (error) {
    console.warn(`[zoom] /zoom_status token error: ${error.message}`);
    await ctx.reply(content.zoom.statusTokenError(error.message));
    return;
  }

  await ctx.reply(content.zoom.statusOk(cfg));
});

// Diagnostic: register the current Telegram user for Zoom without going through
// the /start -> goal -> level funnel. Reuses the exact same registration path,
// so the registrant lands in the same in-memory registry used by
// /sync_zoom_attendance and the same Google Sheets sync runs.
bot.command(['zoom_register_me'], async (ctx) => {
  console.log(`[zoom] /zoom_register_me received from telegramId=${ctx.from.id}`);
  const result = await registerZoomForUser(ctx);

  if (result.ok) {
    if (!result.joinUrl) {
      await ctx.reply(content.zoom.registerNoJoinUrl(result.registrantId));
    }
    // On success with a join_url, registerZoomForUser already sent it to the user.
    return;
  }

  if (result.reason === 'disabled') {
    await ctx.reply(content.zoom.disabled);
  } else if (result.reason === 'missing') {
    await ctx.reply(content.zoom.missingEnv(result.missing));
  } else {
    await ctx.reply(content.zoom.registerError(result.error));
  }
});

bot.command(['sync_zoom_attendance'], async (ctx) => {
  console.log(`[zoom] /sync_zoom_attendance received from telegramId=${ctx.from.id}`);
  const cfg = getZoomConfig();

  if (!cfg.enabled) {
    await ctx.reply(content.zoom.disabled);
    return;
  }

  if (!env.DATABASE_ENABLED) {
    await ctx.reply(content.zoom.attendanceDbRequired);
    return;
  }

  if (cfg.missing.length) {
    await ctx.reply(content.zoom.missingEnv(cfg.missing));
    return;
  }

  try {
    // Registrants now come from PostgreSQL, so this works after any restart/deploy.
    const registrants = await getAllZoomRegistrants();
    const participants = await getMeetingParticipantsReport();
    const classified = classifyAttendance({ participants, registrants });
    console.log(`[zoom] attendance classified registrants=${classified.length} participants=${participants.length}`);

    let synced = 0;
    let followUpsScheduled = 0;
    const counts = { attended: 0, attended_short: 0, no_show: 0 };

    for (const lead of classified) {
      counts[lead.status] = (counts[lead.status] || 0) + 1;

      // 1. Persist attendance to the registrant row.
      await updateZoomAttendance(lead.telegramId, {
        attendanceStatus: lead.status,
        joinTime: lead.joinTime,
        leaveTime: lead.leaveTime,
        durationMinutes: lead.durationMinutes
      });

      // 2. Auto follow-up, claimed atomically so it fires exactly once even on re-sync.
      let followUpSentAt = lead.followUpSentAt || '';
      if (lead.status === 'attended' || lead.status === 'no_show') {
        const claimed = await claimFollowUp(lead.telegramId, lead.status);
        if (claimed) {
          followUpSentAt = claimed.follow_up_sent_at;
          if (lead.status === 'attended') await scheduleFollowUp(lead.telegramId);
          else await scheduleNoShow(lead.telegramId);
          followUpsScheduled += 1;
          console.log(`[zoom] follow-up scheduled telegramId=${lead.telegramId} segment=${lead.status} matchedBy=${lead.matchedBy}`);
        } else {
          console.log(`[zoom] follow-up already sent telegramId=${lead.telegramId} segment=${lead.status} — skipping`);
        }
      }

      // 3. Mirror to Google Sheets.
      const leadCtx = {
        from: {
          id: lead.telegramId,
          first_name: lead.firstName,
          last_name: lead.lastName,
          username: lead.username
        }
      };
      const payload = buildLeadPayload({
        ctx: leadCtx,
        event: 'zoom_attendance',
        stage: lead.status,
        zoom: {
          registrantId: lead.registrantId,
          joinUrl: lead.joinUrl,
          attendanceStatus: lead.status,
          joinTime: lead.joinTime,
          leaveTime: lead.leaveTime,
          durationMinutes: lead.durationMinutes
        },
        followUp: { segment: lead.status, sentAt: followUpSentAt }
      });
      if (await sendLeadToGoogleSheets(payload)) synced += 1;
    }

    await ctx.reply(
      content.zoom.attendanceSummary({
        participants: participants.length,
        classified: classified.length,
        counts,
        followUpsScheduled,
        synced
      })
    );
  } catch (error) {
    console.warn(`[zoom] /sync_zoom_attendance failed: ${error.message}`);
    await ctx.reply(content.zoom.attendanceError(error.message));
  }
});

// Live offer broadcast (Блок 2 «День вебинара» — синхронный оффер). The lecturer
// announces the offer during the webinar; the admin opens this panel and taps ONE
// button to push the offer message to EVERY registered user at that exact moment.
// Admin-gated via ADMIN_TELEGRAM_IDS so a regular participant can never trigger it.
// Showing a button (instead of sending on the command) prevents an accidental
// mass-send and lets the admin see the recipient count before the single tap.
async function showOfferPanel(ctx) {
  console.log(`[offer] offer panel requested telegramId=${ctx.from.id} admin=${isAdmin(ctx)}`);

  if (!isAdmin(ctx)) {
    await ctx.reply(adminIds.size ? content.admin.notAdmin : content.admin.adminsNotConfigured);
    return;
  }

  if (!env.DATABASE_ENABLED) {
    await ctx.reply(content.admin.dbRequired);
    return;
  }

  const users = await tryDb(() => getAllUsers(), 'count offer recipients');
  const count = users ? users.length : 0;
  if (!count) {
    await ctx.reply(content.admin.offerNoRecipients);
    return;
  }

  await ctx.reply(content.admin.offerPrompt(count), content.admin.offerKeyboard());
}

// Admin opens the offer panel either by typing /send_offer or by tapping the
// persistent "📢 Отправить оффер всем" button (shown only on admin menus).
bot.command(['send_offer'], showOfferPanel);
bot.hears(content.admin.offerButton, showOfferPanel);

// One tap on the panel button -> broadcast the offer to all registered users.
// Re-checks admin (defense in depth) and disables the button afterward so it
// cannot be tapped twice.
bot.action('offer:send', async (ctx) => {
  if (!isAdmin(ctx)) {
    await safeAnswerCb(ctx, content.admin.notAdmin);
    return;
  }
  await safeAnswerCb(ctx, content.admin.offerSending);
  console.log(`[offer] broadcast confirmed by telegramId=${ctx.from.id}`);

  try {
    const users = await getAllUsers();
    const sent = await broadcastNow(users, content.messages.live.offer());
    console.log(`[offer] broadcast queued recipients=${sent}/${users.length}`);
    // Remove the buttons and show the result so it can't be sent again.
    await ctx.editMessageText(content.admin.offerSent(sent));
  } catch (error) {
    console.warn(`[offer] broadcast failed: ${error.message}`);
    await ctx.editMessageText(`Не удалось разослать оффер.\n${error.message}`);
  }
});

bot.action('offer:cancel', async (ctx) => {
  await safeAnswerCb(ctx);
  await ctx.editMessageText(content.admin.offerCancelled);
});

command(/^\/вебинар$/i, webinarHandler);
command(/^\/подарок$/i, giftHandler);
command(/^\/диагностика$/i, diagnosticHandler);
command(/^\/(пробная|пробная_версия)$/i, trialHandler);
command(/^\/группа$/i, groupHandler);
command(/^\/запись$/i, recordingHandler);
command(/^\/менеджер$/i, managerHandler);

bot.action(/^goal:(.+)$/, async (ctx) => {
  const goal = ctx.match[1];
  console.log(`[bot] goal answer received telegramId=${ctx.from.id} goal=${goal}`);
  const goalLabel = content.goalLabel(goal);
  const user = await tryDb(() => updateUserByTelegramId(ctx.from.id, { goal }), 'save goal answer');
  syncLeadInBackground(ctx, { user, goal: goalLabel, stage: user?.current_stage || 'goal_answered' }, 'goal');
  await safeAnswerCb(ctx, content.callbacks.goalAck);
  console.log(`[bot] goal callback answered telegramId=${ctx.from.id} next=level`);
  await ctx.reply(content.messages.welcome.level(), content.keyboards.levelInline());
});

bot.action(/^level:(.+)$/, async (ctx) => {
  const level = ctx.match[1];
  console.log(`[bot] level answer received telegramId=${ctx.from.id} level=${level}`);
  const levelLabel = content.levelLabel(level);
  const user = await tryDb(() => updateUserByTelegramId(ctx.from.id, { level, current_stage: 'qualified' }), 'save level answer');
  syncLeadInBackground(ctx, { user, level: levelLabel, stage: 'qualified' }, 'level');
  await safeAnswerCb(ctx, content.callbacks.levelAck);
  console.log(`[bot] level callback answered telegramId=${ctx.from.id} next=final`);
  await ctx.reply(content.messages.welcome.final());

  // User is now qualified: register for Zoom in the background so a slow/failed
  // Zoom API call never delays or breaks the final funnel message above.
  registerZoomForUser(ctx).catch((error) => {
    console.warn(`[zoom] registration crashed telegramId=${ctx.from.id}: ${error.message}`);
  });
});

bot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery?.data || '';
  console.warn(`[bot] unhandled callback_query telegramId=${ctx.from?.id || 'unknown'} data="${callbackData}"`);
  await safeAnswerCb(ctx, content.callbacks.unknownButton);
});
