import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS
});

pool.on('error', (error) => {
  console.error(`[db] Unexpected PostgreSQL pool error: ${error.message}`);
});

export async function checkPostgresConnection() {
  if (!env.DATABASE_ENABLED) {
    console.log('[db] PostgreSQL disabled by DATABASE_ENABLED=false');
    return false;
  }

  try {
    await pool.query('SELECT 1');
    console.log(`[db] PostgreSQL connected at ${env.DATABASE_HOST}:${env.DATABASE_PORT}`);
    return true;
  } catch (error) {
    console.warn(`[db] PostgreSQL unavailable at ${env.DATABASE_HOST}:${env.DATABASE_PORT}. Bot will start, but DB-backed actions may fail. ${error.message}`);
    return false;
  }
}
