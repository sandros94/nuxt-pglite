import { MissingDatabaseConnectionError, getDatabase } from '@netlify/database'
import { drizzle } from 'drizzle-orm/netlify-db'

import type { DatabaseError } from '../../shared/types/database'
import { relations } from '../database/relations'
import * as schema from '../database/schema'

function createDB() {
  return drizzle({ client: getDatabase(), relations })
}

let db: ReturnType<typeof createDB> | undefined

/**
 * Drizzle over Netlify Database. `getDatabase()` reads `NETLIFY_DB_URL`, set
 * by Netlify on a site with the database enabled and by the development
 * socket in `nuxt dev`, and connects with `pg` over the wire protocol unless
 * `NETLIFY_DB_DRIVER=serverless` asks for Neon's drivers. While the variable
 * is unset the route answers `503`, with `reason: 'unconfigured'` as `data`.
 */
export function useDB() {
  try {
    db ??= createDB()
  } catch (error) {
    if (error instanceof MissingDatabaseConnectionError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'No database configured',
        message:
          '`NETLIFY_DB_URL` is unset, so Netlify Database is not enabled on this site (in `nuxt dev` the development socket sets it for you).',
        data: { reason: 'unconfigured' } satisfies DatabaseError,
      })
    }
    throw error
  }
  return db
}

export const tables = schema
