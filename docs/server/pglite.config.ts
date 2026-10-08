import { fileURLToPath } from 'node:url'

// The alias rather than `nuxt-pglite/migrations`: in this monorepo the module
// is stubbed, and its `dist` has no built files for the package exports to reach.
import { applyMigrations } from '#pglite/migrations'

// The directory Netlify applies on deploy, absolute so that it does not depend
// on where `nuxt dev` is started from.
const migrations = fileURLToPath(new URL('../netlify/database/migrations', import.meta.url))

/**
 * The instance the development socket serves in `nuxt dev`. The server side
 * is disabled, so nothing of this file reaches the build.
 */
export default definePGliteServerConfig({
  init: (pg) => applyMigrations(pg, migrations),
  actions: [
    {
      id: 'seed-visits',
      label: 'Seed visits',
      description: 'Inserts three rows into the `visits` table, spread over the last hour',
      run: async ({ pg }) =>
        (
          await pg.query(`
            INSERT INTO visits (created_at)
            VALUES (now() - interval '1 hour'), (now() - interval '30 minutes'), (now())
          `)
        ).affectedRows,
    },
    {
      id: 'clear-visits',
      label: 'Clear visits',
      description: 'Deletes every row of the `visits` table',
      run: async ({ pg }) => (await pg.query('DELETE FROM visits')).affectedRows,
    },
  ],
})
