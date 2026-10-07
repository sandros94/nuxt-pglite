import { vector } from '@electric-sql/pglite-pgvector'

export default definePGliteServerConfig({
  extensions: { vector },
  init: async (pg) => {
    await pg.exec('CREATE EXTENSION IF NOT EXISTS vector')
  },
  devtools: {
    actions: [
      {
        id: 'count',
        label: 'Count test rows',
        run: async ({ pg }) => (await pg.query('SELECT count(*)::int AS count FROM test')).rows[0],
      },
    ],
  },
})
