// Relative rather than `nuxt-pglite/core`: in this monorepo the module is
// stubbed, and its `dist` has no built files for the package exports to reach.
import { definePGliteConfig } from '../../../src/runtime/core'

/**
 * The database the development socket serves and the tests build: the
 * `visits` table, created on every new instance.
 */
export default definePGliteConfig({
  init: (pg) =>
    pg.exec(`
      CREATE TABLE IF NOT EXISTS visits (
        id serial PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `),
})
