import { env } from '../config/env.js';
import { scheduleMessage } from '../queue/queue.js';
import { welcomeMessages, warmupMessages, liveMessages, followMessages, noShowMessage } from './messages.js';
import { content } from '../content/loadContent.js';

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

// ============================================================================
// РАСПИСАНИЕ ВОРОНКИ — где менять тайминги
// ----------------------------------------------------------------------------
// * Дата/время самого ВЕБИНАРА  -> src/content/ru.json (webinar.date / webinar.time).
//   От них считаются все напоминания дня эфира (scheduleLiveDay ниже).
// * Быстрый ТЕСТ-режим          -> .env -> SCHEDULE_TEST_MODE=true (всё придёт
//   за секунды по testDelays). Для боевого режима поставьте false.
// * Тайминги ниже (realSchedule) — для боевого режима (SCHEDULE_TEST_MODE=false).
//   Меняйте числа здесь, если нужно сдвинуть прогрев или welcome-сообщения.
// ============================================================================
const realSchedule = {
  // Блок 0 — после регистрации (welcome-flow):
  welcome: [10_000, 3 * minute, 10 * minute], // 0.1 через 10 сек · 0.2 через 3 мин · 0.3 через 10 мин
  // Блок 1 — прогрев: на какой день ПОСЛЕ регистрации слать сообщение (Дни 1–5,
  // одно в день). Сообщение пропускается, если этот день уже позже вебинара.
  warmupDays: [1, 2, 3, 4, 5],
  // Блок 3 — follow-up после вебинара. Первое сообщение через 15 мин (День 0),
  // дальше — на указанный день после вебинара. По ТЗ: Дни 0,1,2,3,4,5,7 (День 6
  // пропускается, финальный дожим — на 7-й день). followDays[i] — день для
  // followUp[i]; индекс 0 не используется (День 0 = followFirst, 15 мин).
  followFirst: 15 * minute,
  followDays: [0, 1, 2, 3, 4, 5, 7],
  // «Не пришёл на вебинар»: через сколько отправить запись.
  noShow: 15 * minute
};

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

// If caseUsage assigns a case to this funnel slot (e.g. "warmupDay2"), returns
// the rendered case text + its photo so the message shows the case. Returns null
// when no case is assigned or the case id is missing — the caller then keeps the
// normal message. Assignment is data-only (ru.json -> caseUsage); no code edits.
function caseForSlot(slotKey) {
  const caseId = content.caseUsage[slotKey];
  if (!caseId || !content.getCaseById(caseId)) return null;
  return { text: content.renderCase(caseId), media: content.getCaseMedia(caseId) };
}

function webinarStartDate() {
  // Date/time/timezone now come from the content file (src/content/ru.json),
  // so a manager changes the webinar schedule by editing content only.
  return zonedTimeToUtc(content.webinar.date, content.webinar.time, content.webinar.timezone);
}

function delayUntil(date) {
  return Math.max(0, date.getTime() - Date.now());
}

async function scheduleAt({ telegramId, text, date, options = {} }) {
  if (date.getTime() <= Date.now()) return false;
  return scheduleMessage({ telegramId, text, delayMs: delayUntil(date), options });
}

export async function startWelcomeFlow(telegramId) {
  const delays = env.SCHEDULE_TEST_MODE ? testDelays.welcome : realSchedule.welcome;

  await scheduleMessage({ telegramId, text: welcomeMessages.confirm(), delayMs: delays[0] });
  // Gift message: sends the PDF (src/assets/gift.pdf) as a document if present,
  // otherwise the same text with the link. Swap the file any time in src/assets.
  await scheduleMessage({ telegramId, text: welcomeMessages.gift(), delayMs: delays[1], media: content.media.giftPdf });
  await scheduleMessage({
    telegramId,
    text: welcomeMessages.goal(),
    delayMs: delays[2],
    options: content.keyboards.goalInline()
  });
}

// Day 4 of the warm-up series is the lecturer's voice message (per the brief).
// warmupMessages[3] is sent on day i+1 = day 4. Attaching content.media.lecturerVoice
// makes it go out as a voice/audio file from src/assets/lecturer-voice.ogg, with
// the text as a caption and an automatic text-only fallback if the file is absent.
const LECTURER_VOICE_WARMUP_INDEX = 3;

export async function scheduleWarmup(telegramId) {
  const start = webinarStartDate();

  for (let i = 0; i < warmupMessages.length; i += 1) {
    const warmupDay = realSchedule.warmupDays[i] ?? i + 1;

    // A case assigned to this day (caseUsage.warmupDayN) replaces the text+media.
    let text = warmupMessages[i]();
    let media = i === LECTURER_VOICE_WARMUP_INDEX ? content.media.lecturerVoice : null;
    const assigned = caseForSlot(`warmupDay${warmupDay}`);
    if (assigned) {
      text = assigned.text;
      media = assigned.media;
    }

    if (env.SCHEDULE_TEST_MODE) {
      await scheduleMessage({ telegramId, text, delayMs: testDelays.warmup[i], media });
      continue;
    }

    const sendAt = new Date(Date.now() + warmupDay * day);
    if (sendAt.getTime() < start.getTime() - hour) {
      await scheduleMessage({ telegramId, text, delayMs: delayUntil(sendAt), media });
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

// startIndex lets the no-show path skip followMessages[0] (the "Спасибо, что был
// на вебинаре" message meant for attendees) — no-shows get their own Day-0
// recording message instead and then enter Дни 1–7 of the same sequence.
export async function scheduleFollowUp(telegramId, { startIndex = 0 } = {}) {
  for (let i = startIndex; i < followMessages.length; i += 1) {
    const followDay = realSchedule.followDays[i] ?? i;

    // A case assigned to this day (caseUsage.followUpDayN) replaces the text+media.
    let text = followMessages[i]();
    let media = null;
    const assigned = caseForSlot(`followUpDay${followDay}`);
    if (assigned) {
      text = assigned.text;
      media = assigned.media;
    }

    const delayMs = env.SCHEDULE_TEST_MODE
      ? testDelays.follow[i]
      : (i === 0 ? realSchedule.followFirst : followDay * day);
    await scheduleMessage({ telegramId, text, delayMs, media });
  }
}

export async function scheduleNoShow(telegramId) {
  await scheduleMessage({
    telegramId,
    text: noShowMessage(),
    delayMs: env.SCHEDULE_TEST_MODE ? testDelays.noShow : realSchedule.noShow
  });
  // No-show Day 0 is the recording message above; continue with Дни 1–7
  // (followMessages[1..]), skipping the attendee-only Day-0 message.
  await scheduleFollowUp(telegramId, { startIndex: 1 });
}
