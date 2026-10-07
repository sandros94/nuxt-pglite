import { vector } from '@electric-sql/pglite-pgvector'

export default definePGliteConfig({
  extensions: { vector },
  init: async (pg) => {
    await pg.exec('CREATE EXTENSION IF NOT EXISTS vector')
  },
})
