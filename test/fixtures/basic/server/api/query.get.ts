export default defineEventHandler(async () => {
  const pg = await usePGlite()
  await pg.exec('CREATE EXTENSION IF NOT EXISTS citext;')
  const { rows } = await pg.query<{ sum: number; ci: boolean }>(
    `SELECT 1 + 1 AS sum, 'PGlite'::citext = 'pglite'::citext AS ci;`,
  )
  return rows[0]
})
