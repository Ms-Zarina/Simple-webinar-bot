import 'dotenv/config';
import { z } from 'zod';

const rawEnv = process.env;

function pick(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function buildDatabaseUrl(config) {
  const user = encodeURIComponent(config.DATABASE_USER);
  const password = encodeURIComponent(config.DATABASE_PASSWORD);
  const host = config.DATABASE_HOST;
  const port = config.DATABASE_PORT;
  const name = encodeURIComponent(config.DATABASE_NAME);

  return `postgresql://${user}:${password}@${host}:${port}/${name}`;
}

function buildRedisUrl(config) {
  const password = config.REDIS_PASSWORD ? `:${encodeURIComponent(config.REDIS_PASSWORD)}@` : '';
  const db = config.REDIS_DB ? `/${config.REDIS_DB}` : '';

  return `redis://${password}${config.REDIS_HOST}:${config.REDIS_PORT}${db}`;
}

const normalizedEnv = {
  ...rawEnv,
  SCHEDULE_TEST_MODE: pick(rawEnv.SCHEDULE_TEST_MODE, 'false'),
  TELEGRAM_WEBHOOK_ENABLED: pick(rawEnv.TELEGRAM_WEBHOOK_ENABLED, rawEnv.NODE_ENV === 'production' ? 'true' : 'false'),
  TELEGRAM_DROP_PENDING_UPDATES: pick(rawEnv.TELEGRAM_DROP_PENDING_UPDATES, 'false'),
  GOOGLE_SHEETS_WEBHOOK_URL: pick(rawEnv.GOOGLE_SHEETS_WEBHOOK_URL, ''),
  GOOGLE_SHEETS_TIMEOUT_MS: pick(rawEnv.GOOGLE_SHEETS_TIMEOUT_MS, '30000'),
  ZOOM_ENABLED: pick(rawEnv.ZOOM_ENABLED, 'false'),
  ZOOM_ACCOUNT_ID: pick(rawEnv.ZOOM_ACCOUNT_ID, ''),
  ZOOM_CLIENT_ID: pick(rawEnv.ZOOM_CLIENT_ID, ''),
  ZOOM_CLIENT_SECRET: pick(rawEnv.ZOOM_CLIENT_SECRET, ''),
  ZOOM_MEETING_TYPE: pick(rawEnv.ZOOM_MEETING_TYPE, 'meeting'),
  ZOOM_MEETING_ID: pick(rawEnv.ZOOM_MEETING_ID, ''),
  ZOOM_ATTENDANCE_MINUTES: pick(rawEnv.ZOOM_ATTENDANCE_MINUTES, '1'),
  ZOOM_TIMEOUT_MS: pick(rawEnv.ZOOM_TIMEOUT_MS, '15000'),
  DATABASE_ENABLED: pick(rawEnv.DATABASE_ENABLED, 'true'),
  DATABASE_HOST: pick(rawEnv.DATABASE_HOST, rawEnv.POSTGRES_HOST, rawEnv.PGHOST, 'localhost'),
  DATABASE_PORT: pick(rawEnv.DATABASE_PORT, rawEnv.POSTGRES_PORT, rawEnv.PGPORT, '5432'),
  DATABASE_USER: pick(rawEnv.DATABASE_USER, rawEnv.POSTGRES_USER, rawEnv.PGUSER, 'simple'),
  DATABASE_PASSWORD: pick(rawEnv.DATABASE_PASSWORD, rawEnv.POSTGRES_PASSWORD, rawEnv.PGPASSWORD, 'simple'),
  DATABASE_NAME: pick(rawEnv.DATABASE_NAME, rawEnv.POSTGRES_DB, rawEnv.PGDATABASE, 'simple_bot'),
  DATABASE_CONNECTION_TIMEOUT_MS: pick(rawEnv.DATABASE_CONNECTION_TIMEOUT_MS, '1000'),
  REDIS_HOST: pick(rawEnv.REDIS_HOST, 'localhost'),
  REDIS_PORT: pick(rawEnv.REDIS_PORT, '6379'),
  REDIS_PASSWORD: pick(rawEnv.REDIS_PASSWORD, ''),
  REDIS_DB: pick(rawEnv.REDIS_DB, '0')
};

normalizedEnv.DATABASE_URL = pick(rawEnv.DATABASE_URL, buildDatabaseUrl(normalizedEnv));
normalizedEnv.REDIS_URL = pick(rawEnv.REDIS_URL, buildRedisUrl(normalizedEnv));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  SCHEDULE_TEST_MODE: z
    .string()
    .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()))
    .default('false'),
  TELEGRAM_WEBHOOK_ENABLED: z
    .string()
    .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()))
    .default('false'),
  TELEGRAM_DROP_PENDING_UPDATES: z
    .string()
    .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()))
    .default('false'),
  PUBLIC_URL: z.string().url(),
  BOT_TOKEN: z.string().min(10),
  GOOGLE_SHEETS_WEBHOOK_URL: z.string().optional().default(''),
  GOOGLE_SHEETS_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  ZOOM_ENABLED: z
    .string()
    .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()))
    .default('false'),
  ZOOM_ACCOUNT_ID: z.string().optional().default(''),
  ZOOM_CLIENT_ID: z.string().optional().default(''),
  ZOOM_CLIENT_SECRET: z.string().optional().default(''),
  ZOOM_MEETING_TYPE: z.enum(['meeting', 'webinar']).default('meeting'),
  ZOOM_MEETING_ID: z.string().optional().default(''),
  ZOOM_ATTENDANCE_MINUTES: z.coerce.number().nonnegative().default(1),
  ZOOM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  DATABASE_ENABLED: z
    .string()
    .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()))
    .default('true'),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive(),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string(),
  DATABASE_NAME: z.string().min(1),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(10),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive(),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_URL: z.string().min(5),
  // Webinar texts/links/schedule now live in src/content/ru.json (the content
  // file a non-technical manager edits). These env vars are optional fallbacks
  // for backward compatibility — loadContent.js uses JSON first, then env.
  WEBINAR_TITLE: z.string().optional().default(''),
  WEBINAR_DATE: z.string().optional().default(''),
  WEBINAR_TIME: z.string().optional().default(''),
  WEBINAR_TIMEZONE: z.string().optional().default('Europe/Prague'),
  ZOOM_LINK: z.string().optional().default(''),
  PDF_GIFT_URL: z.string().optional().default(''),
  AUDIO_URL: z.string().optional().default(''),
  WEBINAR_MATERIALS_URL: z.string().optional().default(''),
  WEBINAR_RECORDING_URL: z.string().optional().default(''),
  GROUP_LINK: z.string().optional().default(''),
  DIAGNOSTIC_LINK: z.string().optional().default(''),
  TRIAL_LESSON_LINK: z.string().optional().default(''),
  MANAGER_USERNAME: z.string().optional().default('@manager'),
  // Comma-separated Telegram user IDs allowed to run admin commands like
  // /send_offer (the live offer broadcast). Empty = the broadcast is disabled.
  ADMIN_TELEGRAM_IDS: z.string().optional().default('')
});

export const env = schema.parse(normalizedEnv);
