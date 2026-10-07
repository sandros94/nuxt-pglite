import { citext } from '@electric-sql/pglite/contrib/citext'

// Explicit import, so the file also loads outside the server bundle.
import { definePGliteConfig } from '../../../../src/runtime/core'

export default definePGliteConfig({
  extensions: { citext },
  init: async (pg) => {
    await pg.exec('CREATE EXTENSION IF NOT EXISTS citext')
  },
})
