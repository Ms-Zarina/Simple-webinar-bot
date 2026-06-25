import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS
});

pool.on('error', (error) => {
  console.error(`[db] Unexpected PostgreSQL pool error: ${error.message}`);
});

// host:port the pool actually targets. When DATABASE_URL is set (e.g. Render
// PostgreSQL) the split DATABASE_HOST/PORT vars may still hold local defaults, so
// derive the real target from the connection string. Never logs credentials.
function describeDbTarget() {
  try {
    const url = new URL(env.DATABASE_URL);
    return `${url.hostname}:${url.port || 5432}`;
  } catch {
    return `${env.DATABASE_HOST}:${env.DATABASE_PORT}`;
  }
}

export async function checkPostgresConnection() {
  if (!env.DATABASE_ENABLED) {
    console.log('[db] PostgreSQL disabled by DATABASE_ENABLED=false');
    return false;
  }

  try {
    await pool.query('SELECT 1');
    console.log(`[db] PostgreSQL connected at ${describeDbTarget()}`);
    return true;
  } catch (error) {
    console.warn(`[db] PostgreSQL unavailable at ${describeDbTarget()}. Bot will start, but DB-backed actions may fail. ${error.message}`);
    return false;
  }
}

// Closes the pool for graceful shutdown. Safe to call once during SIGTERM/SIGINT.
export async function closePool() {
  try {
    await pool.end();
  } catch (error) {
    console.warn(`[db] pool close error: ${error.message}`);
  }
}
