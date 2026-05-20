import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../env.js';

import * as schema from './schema.js';

// postgres.js connects lazily on first query, so importing this module
// does not open a connection.
export const sql = postgres(env.DATABASE_URL);

export const db = drizzle(sql, { schema });

export type DrizzleDb = typeof db;
