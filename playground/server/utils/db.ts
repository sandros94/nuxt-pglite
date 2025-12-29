import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../database/schema'

export async function useDB() {
  const pg = await usePGlite()
  return drizzle(pg, { schema })
}

export { sql, eq, and, or } from 'drizzle-orm'

export const tables = schema
