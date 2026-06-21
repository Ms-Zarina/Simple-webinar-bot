import express from 'express';
import { env } from './config/env.js';
import { router, setTelegramWebhook } from './routes/webhooks.js';
import { startMessageWorker } from './queue/queue.js';
import { bot } from './bot/bot.js';

const app = express();
app.use(express.json());
app.use('/webhook', router);

app.listen(env.PORT, async () => {
  console.log(`Server started on port ${env.PORT}`);
  await startMessageWorker(bot);
  if (env.NODE_ENV === 'production') await setTelegramWebhook();
});
