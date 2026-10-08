import { defineEventHandler } from 'nuxt/server'

import { tables, useDB } from '../utils/db'

export default defineEventHandler(async (_event) => {
  const db = await useDB()

  await db.execute(`CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );`)

  return db.select().from(tables.test)
})
