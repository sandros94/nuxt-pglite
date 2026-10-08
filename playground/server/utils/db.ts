import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePGlite } from 'drizzle-orm/pglite'
import * as schema from '../database/schema'

import { usePGlite } from '#pglite/server'

/**
 * `DATABASE_URL` is set by the development socket in `nuxt dev` and by the
 * environment in production, so the same driver code runs against PGlite and
 * against a real Postgres. Without it the embedded instance is used instead.
 */
export async function useDB() {
  const url = process.env.DATABASE_URL
  if (url) {
    return drizzlePostgres(url, { schema })
  }
  return drizzlePGlite(await usePGlite(), { schema })
}

export { sql, eq, and, or } from 'drizzle-orm'

export const tables = schema
