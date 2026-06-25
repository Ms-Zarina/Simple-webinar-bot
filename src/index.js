import express from 'express';
import { env } from './config/env.js';
import { router, setTelegramWebhook } from './routes/webhooks.js';
import { startMessageWorker } from './queue/queue.js';
import { bot } from './bot/bot.js';
import { checkPostgresConnection } from './db/pool.js';
import { logGoogleSheetsConfig } from './services/googleSheets.js';
import { logZoomConfig } from './services/zoom.js';

const app = express();
app.use(express.json());
app.use('/webhook', router);

console.log('Starting server on port', env.PORT);

const server = app.listen(env.PORT, async () => {
  console.log('Server listening on port', env.PORT);
  console.log(`Public URL: ${env.PUBLIC_URL}`);
  logGoogleSheetsConfig();
  logZoomConfig();
  await checkPostgresConnection();
  await startMessageWorker(bot);
  if (env.TELEGRAM_WEBHOOK_ENABLED) {
    await setTelegramWebhook();
  } else {
    console.log('Telegram webhook setup skipped: TELEGRAM_WEBHOOK_ENABLED=false');
  }
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
