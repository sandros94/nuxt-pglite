import { defineEventHandler } from 'nuxt/server'

import { usePGlite } from '#pglite/server'

export default defineEventHandler(async () => {
  const pg = await usePGlite()
  const { rows } = await pg.query<{ sum: number; ci: boolean }>(
    `SELECT 1 + 1 AS sum, 'PGlite'::citext = 'pglite'::citext AS ci;`,
  )
  return rows[0]
})
