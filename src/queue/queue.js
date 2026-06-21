import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';

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
    const { telegramId, text, options } = job.data;
    await bot.telegram.sendMessage(telegramId, text, options || {});
  }, { connection });

  messageWorker.on('error', logRedisUnavailable);
  return messageWorker;
}

export async function scheduleMessage({ telegramId, text, delayMs = 0, options = {} }) {
  const queue = await createQueue();
  if (!queue) return false;

  try {
    await queue.add('send-message', { telegramId, text, options }, { delay: delayMs, attempts: 3, backoff: { type: 'exponential', delay: 3000 } });
    return true;
  } catch (error) {
    redisUnavailable = true;
    logRedisUnavailable(error);
    return false;
  }
}

export async function broadcastNow(users, text) {
  let scheduled = 0;
  for (const user of users) {
    if (user.telegram_id && await scheduleMessage({ telegramId: user.telegram_id, text })) scheduled += 1;
  }
  return scheduled;
}
