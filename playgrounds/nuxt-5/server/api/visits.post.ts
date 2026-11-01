import { defineEventHandler } from 'nitro/h3'

import { tables, useDB } from '../utils/db'

export default defineEventHandler(async (event) => {
  const db = await useDB(event)
  const [visit] = await db.insert(tables.visits).values({}).returning()
  return visit
})
