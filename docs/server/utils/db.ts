import type { DatabaseConnection, ServerlessDatabaseConnection } from '@netlify/database'
import { MissingDatabaseConnectionError, getDatabase } from '@netlify/database'
import { drizzle } from 'drizzle-orm/netlify-db'

import type { DatabaseError } from '../../shared/types/database'
import { relations } from '../database/relations'
import * as schema from '../database/schema'

type HttpClient = ServerlessDatabaseConnection['httpClient']

/**
 * `drizzle-orm/netlify-db` 1.0.0-rc.5 calls Neon's HTTP client as
 * `http(text, params, options)`, a form `@neondatabase/serverless` 1.x only
 * accepts through `http.query()`. Route the call there until Drizzle does.
 */
function queryable(http: HttpClient): HttpClient {
  type Rest = Parameters<HttpClient['query']> extends [string, ...infer R] ? R : never
  const call = (text: TemplateStringsArray | string, ...rest: Rest) =>
    typeof text === 'string' ? http.query(text, ...rest) : http(text, ...rest)
  return Object.assign(call, {
    query: http.query.bind(http),
    transaction: http.transaction,
    unsafe: http.unsafe.bind(http),
  })
}

function createDB() {
  const client: DatabaseConnection = getDatabase()
  return drizzle({
    client:
      client.driver === 'serverless'
        ? { ...client, httpClient: queryable(client.httpClient) }
        : client,
    relations,
  })
}

let db: ReturnType<typeof createDB> | undefined

/**
 * Drizzle over Netlify Database. `getDatabase()` reads `NETLIFY_DB_URL`, set
 * by Netlify on a site with the database enabled and by the development
 * socket in `nuxt dev`, and picks the driver from `NETLIFY_DB_DRIVER`: Neon's
 * serverless driver under `serverless`, which Netlify sets in its functions,
 * `pg` over the wire protocol otherwise, which the socket exports as
 * `server`. While the URL is unset the route answers `503`, with
 * `reason: 'unconfigured'` as `data`.
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
