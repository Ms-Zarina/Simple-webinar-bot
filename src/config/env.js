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
  DATABASE_HOST: pick(rawEnv.DATABASE_HOST, rawEnv.POSTGRES_HOST, rawEnv.PGHOST, 'localhost'),
  DATABASE_PORT: pick(rawEnv.DATABASE_PORT, rawEnv.POSTGRES_PORT, rawEnv.PGPORT, '5432'),
  DATABASE_USER: pick(rawEnv.DATABASE_USER, rawEnv.POSTGRES_USER, rawEnv.PGUSER, 'simple'),
  DATABASE_PASSWORD: pick(rawEnv.DATABASE_PASSWORD, rawEnv.POSTGRES_PASSWORD, rawEnv.PGPASSWORD, 'simple'),
  DATABASE_NAME: pick(rawEnv.DATABASE_NAME, rawEnv.POSTGRES_DB, rawEnv.PGDATABASE, 'simple_bot'),
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
  PUBLIC_URL: z.string().url(),
  BOT_TOKEN: z.string().min(10),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive(),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string(),
  DATABASE_NAME: z.string().min(1),
  DATABASE_URL: z.string().min(10),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive(),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_URL: z.string().min(5),
  WEBINAR_TITLE: z.string(),
  WEBINAR_DATE: z.string(),
  WEBINAR_TIME: z.string(),
  WEBINAR_TIMEZONE: z.string().default('Europe/Prague'),
  ZOOM_LINK: z.string(),
  PDF_GIFT_URL: z.string(),
  AUDIO_URL: z.string().optional().default(''),
  WEBINAR_MATERIALS_URL: z.string(),
  WEBINAR_RECORDING_URL: z.string(),
  GROUP_LINK: z.string(),
  DIAGNOSTIC_LINK: z.string(),
  TRIAL_LESSON_LINK: z.string(),
  MANAGER_USERNAME: z.string().default('@manager')
});

export const env = schema.parse(normalizedEnv);
