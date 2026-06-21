import { scheduleMessage } from '../queue/queue.js';
import { welcomeMessages, warmupMessages, liveMessages, followMessages, noShowMessage } from './messages.js';

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

export async function startWelcomeFlow(telegramId) {
  await scheduleMessage({ telegramId, text: welcomeMessages.confirm(), delayMs: 10_000 });
  await scheduleMessage({ telegramId, text: welcomeMessages.gift(), delayMs: 3 * minute });
  await scheduleMessage({
    telegramId,
    text: welcomeMessages.goal(),
    delayMs: 10 * minute,
    options: {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Планирую подать документы в этом году', callback_data: 'goal:this_year' }],
          [{ text: 'Думаю о ПМЖ, но еще не скоро', callback_data: 'goal:later' }],
          [{ text: 'Уже провалил(а) экзамен — хочу пересдать', callback_data: 'goal:retake' }],
          [{ text: 'Просто интересуюсь темой', callback_data: 'goal:interest' }]
        ]
      }
    }
  });
}

export async function scheduleWarmup(telegramId) {
  for (let i = 0; i < warmupMessages.length; i++) {
    await scheduleMessage({ telegramId, text: warmupMessages[i](), delayMs: (i + 1) * day });
  }
}

export async function scheduleLiveDay(telegramId) {
  await scheduleMessage({ telegramId, text: liveMessages.morning(), delayMs: 2 * day });
  await scheduleMessage({ telegramId, text: liveMessages.minus3h(), delayMs: 2 * day + 7 * hour });
  await scheduleMessage({ telegramId, text: liveMessages.minus15m(), delayMs: 2 * day + 9 * hour + 45 * minute });
  await scheduleMessage({ telegramId, text: liveMessages.minus2m(), delayMs: 2 * day + 9 * hour + 58 * minute });
  await scheduleMessage({ telegramId, text: liveMessages.plus10m(), delayMs: 2 * day + 10 * hour + 10 * minute });
  await scheduleMessage({ telegramId, text: liveMessages.plus30m(), delayMs: 2 * day + 10 * hour + 30 * minute });
}

export async function scheduleFollowUp(telegramId) {
  for (let i = 0; i < followMessages.length; i++) {
    await scheduleMessage({ telegramId, text: followMessages[i](), delayMs: i === 0 ? 15 * minute : i * day });
  }
}

export async function scheduleNoShow(telegramId) {
  await scheduleMessage({ telegramId, text: noShowMessage(), delayMs: 15 * minute });
  await scheduleFollowUp(telegramId);
}
