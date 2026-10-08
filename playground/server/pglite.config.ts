import { fileURLToPath } from 'node:url'

import { vector } from '@electric-sql/pglite-pgvector'
import { applyMigrations } from '#pglite/migrations'

// Absolute, so that it does not depend on where `nuxt dev` is started from.
// Only meaningful in `nuxt dev`: a build bundles this file, so the URL then
// points into `.output`, where the migrations are not shipped.
const migrations = fileURLToPath(new URL('./database/migrations', import.meta.url))

// Before the migrations, which may use its types.
const createExtensions = (pg: { exec(sql: string): Promise<unknown> }) =>
  pg.exec('CREATE EXTENSION IF NOT EXISTS vector')

export default definePGliteServerConfig({
  extensions: { vector },
  // A deployed app relies on the platform applying the migrations (Netlify
  // Database runs them at deploy time).
  init: async (pg) => {
    await createExtensions(pg)
  },
  // Replaces the `init` above rather than adding to it, hence both steps.
  $development: {
    init: async (pg) => {
      await createExtensions(pg)
      await applyMigrations(pg, migrations)
    },
  },
  actions: [
    {
      id: 'count',
      label: 'Count test rows',
      run: async ({ pg }) => (await pg.query('SELECT count(*)::int AS count FROM test')).rows[0],
    },
  ],
})
