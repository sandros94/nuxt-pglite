// Relative rather than `nuxt-pglite/core`: the socket module loads this file
// through jiti, which cannot resolve the stub's exports (they point at `.js`
// files that exist only as `.ts` in the monorepo); bundled and vitest files can.
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
