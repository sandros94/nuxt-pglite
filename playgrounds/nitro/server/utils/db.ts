import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { relations } from '../database/relations'
import * as schema from '../database/schema'

function createDB() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('No database: DATABASE_URL is not set.')
  }
  return drizzle({ client: new Pool({ connectionString: url }), relations })
}

export type DB = ReturnType<typeof createDB>

let db: DB | undefined

/** Drizzle over one pool on `DATABASE_URL` (the socket's in `nitro dev`), created on first use. */
export function useDB() {
  return (db ??= createDB())
}

export const tables = schema
