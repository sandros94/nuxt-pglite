import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'
import { vector } from '@electric-sql/pglite/vector'
import { defu } from 'defu'

worker({
  async init(options) {
    const _options = defu(options, {
      extensions: {
        vector,
      },
    })
    return new PGlite(_options)
  },
})
