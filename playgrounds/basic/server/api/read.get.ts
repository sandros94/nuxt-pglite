import { defineEventHandler } from 'nuxt/server'

import { tables, useDB } from '../utils/db'

export default defineEventHandler(async (_event) => {
  const db = await useDB()

  return db.select().from(tables.test)
})
