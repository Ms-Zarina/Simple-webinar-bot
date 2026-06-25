import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { existsSync } from 'fs';
import { dirname, join, extname } from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

// Scheduled messages can carry an optional local media file from src/assets
// (e.g. the lecturer voice on Day 4, or the gift PDF). The file is resolved at
// SEND time, so a manager can swap the file any time before it goes out. If the
// file is missing, the worker falls back to the plain text message — never fails.
const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '../assets');

async function deliverJob(bot, { telegramId, text, options, media }) {
  if (media && media.asset) {
    const filePath = join(assetsDir, media.asset);
    if (existsSync(filePath)) {
      const extra = text ? { caption: text } : {};
      const ext = extname(media.asset).toLowerCase();
      try {
        if (media.kind === 'document') return await bot.telegram.sendDocument(telegramId, { source: filePath }, extra);
        if (media.kind === 'photo') return await bot.telegram.sendPhoto(telegramId, { source: filePath }, extra);
        if (media.kind === 'audio') return await bot.telegram.sendAudio(telegramId, { source: filePath }, extra);
        if (media.kind === 'voice') {
          // True voice bubble needs OGG/OPUS; other formats go as an audio track.
          if (ext === '.ogg' || ext === '.oga') return await bot.telegram.sendVoice(telegramId, { source: filePath }, extra);
          return await bot.telegram.sendAudio(telegramId, { source: filePath }, extra);
        }
      } catch (error) {
        console.warn(`[scheduler] media send failed asset=${media.asset}: ${error.message}; falling back to text`);
      }
    } else {
      console.warn(`[scheduler] media asset not found: ${media.asset}; sending text only`);
    }
  }
  return bot.telegram.sendMessage(telegramId, text, options || {});
}

let connection = null;
let messageQueue = null;
let messageWorker = null;
let redisUnavailable = false;
let redisErrorLogged = false;

function describeRedis() {
  return `${env.REDIS_HOST}:${env.REDIS_PORT}`;
}

function formatError(error) {
  if (Array.isArray(error?.errors) && error.errors.length) {
    return error.errors.map((item) => item.message || item.code || String(item)).join('; ');
  }

  return error?.message || error?.code || String(error);
}

function logRedisUnavailable(error) {
  if (redisErrorLogged) return;
  redisErrorLogged = true;
  const message = formatError(error);
  console.warn(`[scheduler] Redis unavailable at ${describeRedis()}. Scheduled jobs are disabled. ${message}`);
}

async function createQueue() {
  if (messageQueue) return messageQueue;
  if (redisUnavailable) return null;

  const redis = new IORedis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    connectTimeout: 1000,
    retryStrategy: () => null
  });

  redis.on('error', logRedisUnavailable);

  try {
    await redis.ping();
    connection = redis;
    messageQueue = new Queue('telegram-messages', { connection });
    console.log(`[scheduler] Redis connected at ${describeRedis()}`);
    return messageQueue;
  } catch (error) {
    redisUnavailable = true;
    logRedisUnavailable(error);
    await redis.disconnect();
    return null;
  }
}

export async function startMessageWorker(bot) {
  if (messageWorker) return messageWorker;

  const queue = await createQueue();
  if (!queue) return null;

  messageWorker = new Worker('telegram-messages', async (job) => {
    await deliverJob(bot, job.data);
  }, { connection });

  messageWorker.on('error', logRedisUnavailable);
  return messageWorker;
}

export async function scheduleMessage({ telegramId, text, delayMs = 0, options = {}, media = null }) {
  const queue = await createQueue();
  if (!queue) return false;

  try {
    await queue.add('send-message', { telegramId, text, options, media }, { delay: delayMs, attempts: 3, backoff: { type: 'exponential', delay: 3000 } });
    return true;
  } catch (error) {
    redisUnavailable = true;
    logRedisUnavailable(error);
    return false;
  }
}

// Closes the BullMQ worker, queue, and Redis connection for graceful shutdown.
// Safe to call once during SIGTERM/SIGINT; tolerant if Redis was never connected.
export async function shutdownQueue() {
  try {
    if (messageWorker) {
      await messageWorker.close();
      messageWorker = null;
    }
    if (messageQueue) {
      await messageQueue.close();
      messageQueue = null;
    }
    if (connection) {
      await connection.quit().catch(() => connection.disconnect());
      connection = null;
    }
  } catch (error) {
    console.warn(`[scheduler] shutdown error: ${error.message}`);
  }
}

export async function broadcastNow(users, text) {
  let scheduled = 0;
  for (const user of users) {
    if (user.telegram_id && await scheduleMessage({ telegramId: user.telegram_id, text })) scheduled += 1;
  }
  return scheduled;
}
