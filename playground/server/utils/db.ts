import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../database/schema'

// TODO: https://github.com/nuxt/nuxt/issues/29263
import type { PGliteServerInstance } from '#pglite/server/utils/pglite'

export async function useDB() {
  const pg = await usePGlite()
  return drizzle(pg as unknown as PGliteServerInstance, { schema })
}

export { sql, eq, and, or } from 'drizzle-orm'

export const tables = schema
