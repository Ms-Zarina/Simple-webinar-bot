import { Telegraf, Markup } from 'telegraf';
import { env } from '../config/env.js';
import { upsertTelegramUser, updateUserByTelegramId } from '../db/users.js';
import { startWelcomeFlow, scheduleWarmup, scheduleLiveDay } from '../flows/scheduler.js';
import { welcomeMessages, common } from '../flows/messages.js';

export const bot = new Telegraf(env.BOT_TOKEN);

bot.start(async (ctx) => {
  const user = await upsertTelegramUser(ctx);
  await ctx.reply('Добро пожаловать! Регистрация на вебинар активирована.');
  await startWelcomeFlow(ctx.from.id);
  await scheduleWarmup(ctx.from.id);
  await scheduleLiveDay(ctx.from.id);
});

bot.command(['начало', 'start'], async (ctx) => {
  await ctx.reply('Главное меню', Markup.keyboard([
    ['/вебинар', '/подарок'],
    ['/диагностика', '/группа'],
    ['/запись', '/менеджер']
  ]).resize());
});

bot.command('вебинар', (ctx) => ctx.reply(`${common.webinarLine()}\n\nСсылка: ${env.ZOOM_LINK}`));
bot.command('подарок', (ctx) => ctx.reply(`PDF-лидмагнит: ${env.PDF_GIFT_URL}`));
bot.command('диагностика', (ctx) => ctx.reply(`Запись на бесплатную диагностику: ${env.DIAGNOSTIC_LINK}`));
bot.command('пробная', (ctx) => ctx.reply(`Запись на пробный урок: ${env.TRIAL_LESSON_LINK}`));
bot.command('группа', (ctx) => ctx.reply(`Групповые занятия по подготовке к ПМЖ: ${env.GROUP_LINK}`));
bot.command('запись', (ctx) => ctx.reply(`Запись вебинара: ${env.WEBINAR_RECORDING_URL}`));
bot.command('менеджер', (ctx) => ctx.reply(`Написать менеджеру: ${env.MANAGER_USERNAME}`));

bot.action(/goal:(.+)/, async (ctx) => {
  const goal = ctx.match[1];
  await updateUserByTelegramId(ctx.from.id, { goal });
  await ctx.answerCbQuery('Ответ сохранён');
  await ctx.reply(welcomeMessages.level(), {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Ноль / очень слабый', callback_data: 'level:zero' }],
        [{ text: 'A1-A2 — базовые фразы', callback_data: 'level:a1a2' }],
        [{ text: 'B1 — могу общаться', callback_data: 'level:b1' }],
        [{ text: 'B2+ — говорю свободно', callback_data: 'level:b2plus' }]
      ]
    }
  });
});

bot.action(/level:(.+)/, async (ctx) => {
  const level = ctx.match[1];
  await updateUserByTelegramId(ctx.from.id, { level, current_stage: 'qualified' });
  await ctx.answerCbQuery('Уровень сохранён');
  await ctx.reply(welcomeMessages.final());
});
