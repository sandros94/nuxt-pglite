import { worker } from '@electric-sql/pglite/worker'
import { PGlite } from '@electric-sql/pglite'

import {
  extensions as exts,
} from '#build/pglite/extensions'

worker({
  async init(options) {
    const { dataDir, ...opts } = options

    // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
    const { live, electric, ...extensions } = exts

    return new PGlite(dataDir, {
      ...opts,
      extensions,
    })
  },
})
