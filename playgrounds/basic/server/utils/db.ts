import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePGlite } from 'drizzle-orm/pglite'

import { relations } from '../database/relations'
import * as schema from '../database/schema'

import { usePGlite } from '#pglite/server'

/**
 * `DATABASE_URL` is set by the development socket in `nuxt dev` and by the
 * environment in production, so the same driver code runs against PGlite and
 * against a real Postgres. Without it the embedded instance is used instead.
 */
async function createDB() {
  const url = process.env.DATABASE_URL
  if (url) {
    return drizzlePostgres(url, { relations })
  }
  return drizzlePGlite({ client: await usePGlite(), relations })
}

let db: ReturnType<typeof createDB> | undefined

/** One instance per process, so that the `pg` pool is shared between requests. */
export function useDB() {
  db ??= createDB().catch((error: unknown) => {
    // Let the next call retry rather than caching the failure.
    db = undefined
    throw error
  })
  return db
}

export { sql, eq, and, or } from 'drizzle-orm'

export const tables = schema
export { schema }
