import { count, desc } from 'drizzle-orm'

import type { VisitsResponse } from '../../shared/types/visits'
import { tables, useDB } from './db'

/** Runs `write` (if any) and reads the latest visits back. */
export async function withVisits(write?: 'insert'): Promise<VisitsResponse> {
  const db = useDB()
  if (write === 'insert') {
    await db.insert(tables.visits).values({})
  }
  const [latest, [totals]] = await Promise.all([
    db.select().from(tables.visits).orderBy(desc(tables.visits.id)).limit(5),
    db.select({ total: count() }).from(tables.visits),
  ])
  return {
    total: totals?.total ?? 0,
    latest: latest.map(({ id, createdAt }) => ({ id, createdAt: createdAt.toISOString() })),
  }
}
