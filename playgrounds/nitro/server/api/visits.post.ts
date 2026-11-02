import { defineHandler } from 'nitro'

import { tables, useDB } from '../utils/db'

export default defineHandler(async () => {
  const db = useDB()
  const [visit] = await db.insert(tables.visits).values({}).returning()
  return visit
})
