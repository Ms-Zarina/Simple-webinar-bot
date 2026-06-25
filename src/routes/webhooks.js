import express from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { bot } from '../bot/bot.js';
import { getAllUsers, updateUserByTelegramId } from '../db/users.js';
import { broadcastNow } from '../queue/queue.js';
import { liveMessages } from '../flows/messages.js';
import { scheduleFollowUp, scheduleNoShow } from '../flows/scheduler.js';

export const router = express.Router();

function describeTelegramUpdate(update) {
  if (update.callback_query) {
    return `callback_query data="${update.callback_query.data || ''}" from=${update.callback_query.from?.id || 'unknown'}`;
  }

  if (update.message) {
    return `message text="${update.message.text || ''}" from=${update.message.from?.id || 'unknown'}`;
  }

  if (update.edited_message) {
    return `edited_message from=${update.edited_message.from?.id || 'unknown'}`;
  }

  return Object.keys(update || {}).join(',') || 'empty';
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

router.post('/telegram', asyncRoute(async (req, res) => {
  console.log(`[webhook] Telegram update ${req.body?.update_id || 'unknown'}: ${describeTelegramUpdate(req.body)}`);

  // Acknowledge immediately so Telegram never times out or retries, THEN process.
  // Replies are sent via the Bot API (not the webhook HTTP response), so acking
  // first does not stop the bot from answering — and a slow/failed handler can no
  // longer leave the request hanging or block delivery of the next update.
  res.sendStatus(200);

  try {
    await bot.handleUpdate(req.body);
  } catch (error) {
    console.error(`[webhook] handleUpdate failed for update ${req.body?.update_id}: ${error.message}`);
  }
}));

router.get('/health', (_, res) => res.json({ ok: true }));

router.get('/telegram/status', asyncRoute(async (_, res) => {
  const info = await bot.telegram.getWebhookInfo();
  res.json({ ok: true, webhook: info });
}));

router.post('/admin/broadcast-offer', asyncRoute(async (_, res) => {
  const users = await getAllUsers();
  const sentTo = await broadcastNow(users, liveMessages.offer());
  res.json({ ok: true, sent_to: sentTo });
}));

router.post('/admin/mark-attendance', asyncRoute(async (req, res) => {
  const schema = z.object({ telegramId: z.number(), attended: z.boolean() });
  const { telegramId, attended } = schema.parse(req.body);
  await updateUserByTelegramId(telegramId, { attended });
  if (attended) await scheduleFollowUp(telegramId);
  else await scheduleNoShow(telegramId);
  res.json({ ok: true });
}));

router.post('/landing/register', asyncRoute(async (req, res) => {
  // MVP: лендинг должен передать telegramId после перехода пользователя в бот.
  // Если лендинг собирает только телефон/email, нужна отдельная deep-link схема.
  const schema = z.object({ telegramId: z.number() });
  const { telegramId } = schema.parse(req.body);
  await bot.telegram.sendMessage(telegramId, 'Регистрация получена. Бот активирован.');
  res.json({ ok: true });
}));

export async function setTelegramWebhook() {
  const url = `${env.PUBLIC_URL}/webhook/telegram`;
  try {
    await bot.telegram.setWebhook(url, {
      drop_pending_updates: env.TELEGRAM_DROP_PENDING_UPDATES
    });
    console.log(`Telegram webhook set: ${url}`);
  } catch (error) {
    if (error.message?.includes('ETIMEDOUT') || error.code === 'ETIMEDOUT') {
      console.error(`Telegram webhook setup timed out for ${url}. The bot keeps running; retry after network access to api.telegram.org is available. ${error.message}`);
      return;
    }

    console.error(`Telegram webhook setup failed for ${url}. The bot keeps running. ${error.message}`);
  }
}

router.use((error, req, res, _next) => {
  console.error(`[webhook] ${req.method} ${req.originalUrl} failed: ${error.message}`);
  if (!res.headersSent) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});
