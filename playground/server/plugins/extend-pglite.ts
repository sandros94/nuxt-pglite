import { vector } from '@electric-sql/pglite/vector'

import { defineNitroPlugin } from '#imports'
import { pgliteHooks } from '#pglite-utils'

export default defineNitroPlugin(() => {
  pgliteHooks.hook('pglite:config', (options) => {
    options.extensions = {
      vector,
    }
  })

  pgliteHooks.hookOnce('pglite', async (pg) => {
    await pg.query('CREATE EXTENSION IF NOT EXISTS vector;')
    console.log('pgvector is available?', (await pg.query<any>('SELECT * FROM pg_extension;')).rows.some(e => e.extname === 'vector'))
  })
})

declare module '#pglite-utils' {
  interface PGliteServerExtensions {
    vector: typeof vector
  }
}
