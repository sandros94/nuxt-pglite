import { drizzle } from 'drizzle-orm/netlify-db'

import { relations } from '../database/relations'
import * as schema from '../database/schema'

function createDB() {
  return drizzle({ relations })
}

let db: ReturnType<typeof createDB> | undefined

/**
 * Drizzle over Netlify Database. `NETLIFY_DB_URL` is set by Netlify on a site
 * with the database enabled, and by the development socket in `nuxt dev`,
 * along with `NETLIFY_DB_DRIVER=server` so that `pg` is used rather than
 * Neon's HTTP driver, which the socket cannot answer. `undefined` when it is
 * unset, since `drizzle()` throws without it, so the routes can say so.
 */
export function useDB() {
  if (!process.env.NETLIFY_DB_URL) {
    return undefined
  }
  db ??= createDB()
  return db
}

export const tables = schema
