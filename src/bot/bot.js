import { Telegraf, Markup } from 'telegraf';
import { env } from '../config/env.js';
import { upsertTelegramUser, updateUserByTelegramId } from '../db/users.js';
import { startWelcomeFlow, scheduleWarmup, scheduleLiveDay } from '../flows/scheduler.js';
import { welcomeMessages, common } from '../flows/messages.js';

export const bot = new Telegraf(env.BOT_TOKEN);

function menuKeyboard() {
  return Markup.keyboard([
    ['/вебинар', '/подарок'],
    ['/диагностика', '/группа'],
    ['/запись', '/менеджер']
  ]).resize();
}

async function replyMainMenu(ctx) {
  await ctx.reply('Главное меню', menuKeyboard());
}

function command(pattern, handler) {
  bot.hears(pattern, handler);
}

bot.start(async (ctx) => {
  await upsertTelegramUser(ctx);
  await ctx.reply('Добро пожаловать! Регистрация на вебинар активирована.', menuKeyboard());
  await startWelcomeFlow(ctx.from.id);
  await scheduleWarmup(ctx.from.id);
  await scheduleLiveDay(ctx.from.id);
});

bot.command(['start', 'help', 'menu'], replyMainMenu);
command(/^\/(начало|меню)$/i, replyMainMenu);

const webinarHandler = (ctx) => ctx.reply(`${common.webinarLine()}\n\nСсылка: ${env.ZOOM_LINK}`);
const giftHandler = (ctx) => ctx.reply(`PDF-лидмагнит: ${env.PDF_GIFT_URL}`);
const diagnosticHandler = (ctx) => ctx.reply(`Запись на бесплатную диагностику: ${env.DIAGNOSTIC_LINK}`);
const trialHandler = (ctx) => ctx.reply(`Запись на пробный урок: ${env.TRIAL_LESSON_LINK}`);
const groupHandler = (ctx) => ctx.reply(`Групповые занятия по подготовке к ПМЖ: ${env.GROUP_LINK}`);
const recordingHandler = (ctx) => ctx.reply(`Запись вебинара: ${env.WEBINAR_RECORDING_URL}`);
const managerHandler = (ctx) => ctx.reply(`Написать менеджеру: ${env.MANAGER_USERNAME}`);

bot.command(['webinar'], webinarHandler);
bot.command(['gift'], giftHandler);
bot.command(['diagnostic'], diagnosticHandler);
bot.command(['trial'], trialHandler);
bot.command(['group'], groupHandler);
bot.command(['recording'], recordingHandler);
bot.command(['manager'], managerHandler);

command(/^\/вебинар$/i, webinarHandler);
command(/^\/подарок$/i, giftHandler);
command(/^\/диагностика$/i, diagnosticHandler);
command(/^\/(пробная|пробная_версия)$/i, trialHandler);
command(/^\/группа$/i, groupHandler);
command(/^\/запись$/i, recordingHandler);
command(/^\/менеджер$/i, managerHandler);

bot.action(/goal:(.+)/, async (ctx) => {
  const goal = ctx.match[1];
  await updateUserByTelegramId(ctx.from.id, { goal });
  await ctx.answerCbQuery('Ответ сохранен');
  await ctx.reply(welcomeMessages.level(), {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Ноль / очень слабый', callback_data: 'level:zero' }],
        [{ text: 'A1-A2 - базовые фразы', callback_data: 'level:a1a2' }],
        [{ text: 'B1 - могу общаться', callback_data: 'level:b1' }],
        [{ text: 'B2+ - говорю свободно', callback_data: 'level:b2plus' }]
      ]
    }
  });
});

bot.action(/level:(.+)/, async (ctx) => {
  const level = ctx.match[1];
  await updateUserByTelegramId(ctx.from.id, { level, current_stage: 'qualified' });
  await ctx.answerCbQuery('Уровень сохранен');
  await ctx.reply(welcomeMessages.final());
});
