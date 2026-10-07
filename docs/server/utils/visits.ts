import { count, desc } from 'drizzle-orm'

import { tables, useDB } from './db'

const UNCONFIGURED =
  'No database configured: set `DATABASE_URL` (in `nuxt dev` the development socket sets it for you).'

/**
 * Runs `write` (if any) and reads the latest visits back, turning a missing or
 * unreachable database into a message rather than a 500.
 */
export async function withVisits(write?: 'insert'): Promise<VisitsResponse> {
  const db = useDB()
  if (!db) {
    return { status: 'unconfigured', message: UNCONFIGURED }
  }
  try {
    if (write === 'insert') {
      await db.insert(tables.visits).values({})
    }
    const [latest, [totals]] = await Promise.all([
      db.select().from(tables.visits).orderBy(desc(tables.visits.id)).limit(5),
      db.select({ total: count() }).from(tables.visits),
    ])
    return {
      status: 'ok',
      total: totals?.total ?? 0,
      latest: latest.map(({ id, createdAt }) => ({ id, createdAt: createdAt.toISOString() })),
    }
  } catch (error) {
    // Drizzle wraps the driver's error, which says what actually went wrong.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
    return { status: 'error', message: cause instanceof Error ? cause.message : String(cause) }
  }
}
