import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../database/schema'

let db: NodePgDatabase<typeof schema> | undefined

/**
 * Drizzle over `DATABASE_URL`: the development socket sets it in `nuxt dev`,
 * the host's environment in production. `undefined` when neither does.
 */
export function useDB() {
  const url = process.env.DATABASE_URL
  if (!url) {
    return undefined
  }
  db ??= drizzle(url, { schema })
  return db
}

export const tables = schema
