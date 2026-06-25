import express from 'express';
import { env } from './config/env.js';
import { router, setTelegramWebhook } from './routes/webhooks.js';
import { startMessageWorker, shutdownQueue } from './queue/queue.js';
import { bot } from './bot/bot.js';
import { checkPostgresConnection, closePool } from './db/pool.js';
import { logGoogleSheetsConfig } from './services/googleSheets.js';
import { logZoomConfig } from './services/zoom.js';

const SERVICE_NAME = 'simple-webinar-bot';
const startedAt = Date.now();

const app = express();
app.use(express.json());

// Top-level health endpoint for Render (and any uptime monitor). No secrets.
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: SERVICE_NAME,
    environment: env.NODE_ENV,
    uptime: Math.round((Date.now() - startedAt) / 1000)
  });
});

app.use('/webhook', router);

const webhookUrl = `${env.PUBLIC_URL}/webhook/telegram`;

console.log(`Starting ${SERVICE_NAME} (env=${env.NODE_ENV}) on port ${env.PORT}`);

const server = app.listen(env.PORT, async () => {
  console.log(`Server listening on port ${env.PORT}`);
  console.log(`Public URL: ${env.PUBLIC_URL}`);
  console.log(`Telegram webhook: ${webhookUrl}`);
  console.log(`Health check: ${env.PUBLIC_URL}/health`);
  logGoogleSheetsConfig();
  logZoomConfig();
  await checkPostgresConnection();
  await startMessageWorker(bot);
  if (env.TELEGRAM_WEBHOOK_ENABLED) {
    await setTelegramWebhook();
  } else {
    console.log('Telegram webhook setup skipped: TELEGRAM_WEBHOOK_ENABLED=false');
  }
  console.log(`${SERVICE_NAME} startup complete.`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${env.PORT} is already in use. Stop the old dev process and start again.`);
    process.exit(1);
    return;
  }

  console.error(`Server failed to start: ${error.message}`);
  process.exit(1);
});

// --- Process stability (deployment hardening; no business logic) -------------
// Render sends SIGTERM on deploy/restart. Close the HTTP server, BullMQ worker,
// Redis connection and PostgreSQL pool so in-flight work drains and connections
// are released cleanly. A hard timeout guarantees the process still exits.
let shuttingDown = false;

async function gracefulShutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${reason}: closing gracefully…`);

  const cleanup = (async () => {
    await new Promise((resolve) => server.close(() => resolve()));
    console.log('[shutdown] HTTP server closed');
    await shutdownQueue();
    console.log('[shutdown] Redis/BullMQ closed');
    await closePool();
    console.log('[shutdown] PostgreSQL pool closed');
  })();

  try {
    await Promise.race([
      cleanup,
      new Promise((resolve) => setTimeout(resolve, 10_000)) // hard cap so we always exit
    ]);
  } catch (error) {
    console.error(`[shutdown] error during shutdown: ${error.message}`);
  } finally {
    console.log('[shutdown] done');
    process.exit(exitCode);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Log loudly — never swallow silently. Rejections are logged but do not kill the
// process; an uncaught exception leaves the process in an unknown state, so we
// shut down cleanly and exit non-zero (Render restarts the service).
process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error(`[process] Unhandled promise rejection: ${detail}`);
});

process.on('uncaughtException', (error) => {
  console.error(`[process] Uncaught exception: ${error.stack || error.message}`);
  gracefulShutdown('uncaughtException', 1);
});
