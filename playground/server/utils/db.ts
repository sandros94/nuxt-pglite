import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../database/schema'

export function useDB() {
  const pg = usePGlite()
  return drizzle(pg, { schema })
}

export { sql, eq, and, or } from 'drizzle-orm'

export const tables = schema
