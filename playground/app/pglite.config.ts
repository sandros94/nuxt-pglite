import { live } from '@electric-sql/pglite/live'
import { vector } from '@electric-sql/pglite-pgvector'

export default definePGliteClientConfig({
  dataDir: 'idb://nuxt-pglite',
  extensions: { vector },
  clientExtensions: { live },
  init: async (pg) => {
    await pg.exec('CREATE EXTENSION IF NOT EXISTS vector')
  },
})
