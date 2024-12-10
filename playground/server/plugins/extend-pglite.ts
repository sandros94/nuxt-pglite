import { vector } from '@electric-sql/pglite/vector'

import { defineNitroPlugin } from '#imports'
import { pgliteHooks } from '#pglite-utils'

export default defineNitroPlugin(() => {
  pgliteHooks.hook('pglite:config', (options) => {
    // options.debug = 2

    options.extensions = {
      ...options.extensions,
      vector,
    }
  })
})

declare module '#pglite-utils' {
  interface PGliteServerExtensions {
    vector: typeof vector
  }
}
