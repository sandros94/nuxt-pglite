import { defineHandler } from 'nitro'

import { tables, useDB } from '../utils/db'

export default defineHandler(async (event) => {
  const db = await useDB(event)
  const [visit] = await db.insert(tables.visits).values({}).returning()
  return visit
})
