import { defineEventHandler } from 'nuxt/server'
import { Client } from 'pg'

// Production-shaped: a plain `pg` client on `DATABASE_URL`, no PGlite branch.
export default defineEventHandler(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query<{ name: string }>('SELECT name FROM items ORDER BY id')
    return rows
  } finally {
    await client.end()
  }
})
