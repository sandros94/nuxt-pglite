import { count, desc } from 'drizzle-orm'
import { defineHandler } from 'nitro'

import { tables, useDB } from '../utils/db'

export default defineHandler(async (event) => {
  const db = await useDB(event)
  const [latest, [totals]] = await Promise.all([
    db.select().from(tables.visits).orderBy(desc(tables.visits.id)).limit(5),
    db.select({ total: count() }).from(tables.visits),
  ])
  return { total: totals?.total ?? 0, latest }
})
