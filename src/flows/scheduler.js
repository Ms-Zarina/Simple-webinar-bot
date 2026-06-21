import { env } from '../config/env.js';
import { scheduleMessage } from '../queue/queue.js';
import { welcomeMessages, warmupMessages, liveMessages, followMessages, noShowMessage } from './messages.js';

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

const testDelays = {
  welcome: [10_000, 20_000, 30_000],
  warmup: [40_000, 50_000, 60_000, 70_000, 80_000],
  live: [90_000, 100_000, 110_000, 120_000, 130_000, 140_000],
  follow: [30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000],
  noShow: 30_000
};

function getDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function getDateAsUtcInTimeZone(date, timeZone) {
  const parts = getDateParts(date, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function zonedTimeToUtc(dateValue, timeValue, timeZone) {
  const [year, month, dayOfMonth] = dateValue.split('-').map(Number);
  const [hourValue, minuteValue] = timeValue.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, dayOfMonth, hourValue, minuteValue, 0);
  const timeZoneOffset = getDateAsUtcInTimeZone(new Date(utcGuess), timeZone) - utcGuess;

  return new Date(utcGuess - timeZoneOffset);
}

function webinarStartDate() {
  return zonedTimeToUtc(env.WEBINAR_DATE, env.WEBINAR_TIME, env.WEBINAR_TIMEZONE);
}

function delayUntil(date) {
  return Math.max(0, date.getTime() - Date.now());
}

async function scheduleAt({ telegramId, text, date, options = {} }) {
  if (date.getTime() <= Date.now()) return false;
  return scheduleMessage({ telegramId, text, delayMs: delayUntil(date), options });
}

export async function startWelcomeFlow(telegramId) {
  const delays = env.SCHEDULE_TEST_MODE ? testDelays.welcome : [10_000, 3 * minute, 10 * minute];

  await scheduleMessage({ telegramId, text: welcomeMessages.confirm(), delayMs: delays[0] });
  await scheduleMessage({ telegramId, text: welcomeMessages.gift(), delayMs: delays[1] });
  await scheduleMessage({
    telegramId,
    text: welcomeMessages.goal(),
    delayMs: delays[2],
    options: {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Планирую подать документы в этом году', callback_data: 'goal:this_year' }],
          [{ text: 'Думаю о ПМЖ, но еще не скоро', callback_data: 'goal:later' }],
          [{ text: 'Уже провалил(а) экзамен - хочу пересдать', callback_data: 'goal:retake' }],
          [{ text: 'Просто интересуюсь темой', callback_data: 'goal:interest' }]
        ]
      }
    }
  });
}

export async function scheduleWarmup(telegramId) {
  const start = webinarStartDate();

  for (let i = 0; i < warmupMessages.length; i += 1) {
    if (env.SCHEDULE_TEST_MODE) {
      await scheduleMessage({ telegramId, text: warmupMessages[i](), delayMs: testDelays.warmup[i] });
      continue;
    }

    const sendAt = new Date(Date.now() + (i + 1) * day);
    if (sendAt.getTime() < start.getTime() - hour) {
      await scheduleMessage({ telegramId, text: warmupMessages[i](), delayMs: delayUntil(sendAt) });
    }
  }
}

export async function scheduleLiveDay(telegramId) {
  const start = webinarStartDate();
  const messages = [
    { text: liveMessages.morning(), offsetMs: -10 * hour },
    { text: liveMessages.minus3h(), offsetMs: -3 * hour },
    { text: liveMessages.minus15m(), offsetMs: -15 * minute },
    { text: liveMessages.minus2m(), offsetMs: -2 * minute },
    { text: liveMessages.plus10m(), offsetMs: 10 * minute },
    { text: liveMessages.plus30m(), offsetMs: 30 * minute }
  ];

  for (let i = 0; i < messages.length; i += 1) {
    const item = messages[i];
    if (env.SCHEDULE_TEST_MODE) {
      await scheduleMessage({ telegramId, text: item.text, delayMs: testDelays.live[i] });
      continue;
    }

    await scheduleAt({
      telegramId,
      text: item.text,
      date: new Date(start.getTime() + item.offsetMs)
    });
  }
}

export async function scheduleFollowUp(telegramId) {
  for (let i = 0; i < followMessages.length; i += 1) {
    const delayMs = env.SCHEDULE_TEST_MODE ? testDelays.follow[i] : (i === 0 ? 15 * minute : i * day);
    await scheduleMessage({ telegramId, text: followMessages[i](), delayMs });
  }
}

export async function scheduleNoShow(telegramId) {
  await scheduleMessage({
    telegramId,
    text: noShowMessage(),
    delayMs: env.SCHEDULE_TEST_MODE ? testDelays.noShow : 15 * minute
  });
  await scheduleFollowUp(telegramId);
}
