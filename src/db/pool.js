import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

pool.on('error', (error) => {
  console.error(`[db] Unexpected PostgreSQL pool error: ${error.message}`);
});
