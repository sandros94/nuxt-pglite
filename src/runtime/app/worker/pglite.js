import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'

worker({
  async init(options) {
    const { dataDir, ...opts } = options
    return new PGlite(dataDir, opts)
  },
})
