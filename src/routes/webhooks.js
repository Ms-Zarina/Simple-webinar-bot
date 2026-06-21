import express from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { bot } from '../bot/bot.js';
import { getAllUsers, updateUserByTelegramId } from '../db/users.js';
import { broadcastNow } from '../queue/queue.js';
import { liveMessages } from '../flows/messages.js';
import { scheduleFollowUp, scheduleNoShow } from '../flows/scheduler.js';

export const router = express.Router();

router.post('/telegram', (req, res) => bot.handleUpdate(req.body, res));

router.get('/health', (_, res) => res.json({ ok: true }));

router.post('/admin/broadcast-offer', async (_, res) => {
  const users = await getAllUsers();
  const sentTo = await broadcastNow(users, liveMessages.offer());
  res.json({ ok: true, sent_to: sentTo });
});

router.post('/admin/mark-attendance', async (req, res) => {
  const schema = z.object({ telegramId: z.number(), attended: z.boolean() });
  const { telegramId, attended } = schema.parse(req.body);
  await updateUserByTelegramId(telegramId, { attended });
  if (attended) await scheduleFollowUp(telegramId);
  else await scheduleNoShow(telegramId);
  res.json({ ok: true });
});

router.post('/landing/register', async (req, res) => {
  // MVP: лендинг должен передать telegramId после перехода пользователя в бот.
  // Если лендинг собирает только телефон/email, нужна отдельная deep-link схема.
  const schema = z.object({ telegramId: z.number() });
  const { telegramId } = schema.parse(req.body);
  await bot.telegram.sendMessage(telegramId, 'Регистрация получена. Бот активирован.');
  res.json({ ok: true });
});

export async function setTelegramWebhook() {
  const url = `${env.PUBLIC_URL}/webhook/telegram`;
  await bot.telegram.setWebhook(url);
  console.log(`Telegram webhook set: ${url}`);
}
