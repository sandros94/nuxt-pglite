import { fileURLToPath } from 'node:url'

import { vector } from '@electric-sql/pglite-pgvector'
import { applyMigrations } from '#pglite/migrations'

// Absolute, so that it does not depend on where `nuxt dev` is started from.
const migrations = fileURLToPath(new URL('./database/migrations', import.meta.url))

export default definePGliteServerConfig({
  extensions: { vector },
  init: async (pg) => {
    // Before the migrations, which may use its types.
    await pg.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await applyMigrations(pg, migrations)
  },
  devtools: {
    actions: [
      {
        id: 'count',
        label: 'Count test rows',
        run: async ({ pg }) => (await pg.query('SELECT count(*)::int AS count FROM test')).rows[0],
      },
    ],
  },
})
