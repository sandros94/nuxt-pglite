/**
 * The instance the development socket serves in `nuxt dev`. The server side
 * is disabled, so nothing of this file reaches the build.
 */
export default definePGliteServerConfig({
  init: async (pg) => {
    // The same table `drizzle-kit push` creates from `server/database/schema.ts`.
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS visits (
        id serial PRIMARY KEY,
        created_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `)
  },
  devtools: {
    actions: [
      {
        id: 'clear-visits',
        label: 'Clear visits',
        description: 'Deletes every row of the `visits` table',
        run: async ({ pg }) => (await pg.query('DELETE FROM visits')).affectedRows,
      },
    ],
  },
})
