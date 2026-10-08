import { live } from '@electric-sql/pglite/live'

// Imported explicitly: the worker bundle has no auto-imports.
import { PLANETS_SQL, TODOS_SQL } from './utils/examples'

export default definePGliteClientConfig({
  dataDir: 'idb://nuxt-pglite-docs',
  clientExtensions: { live },
  init: async (pg) => {
    await pg.exec(TODOS_SQL + PLANETS_SQL)
  },
  devtoolsActions: [
    {
      id: 'reset',
      label: 'Reset the examples',
      description: 'Drops and seeds the tables the interactive examples use',
      run: async ({ pg }) => {
        await pg.exec(`DROP TABLE IF EXISTS todos, planets; ${TODOS_SQL}${PLANETS_SQL}`)
        return 'Tables recreated'
      },
    },
  ],
})
