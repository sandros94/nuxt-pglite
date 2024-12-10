import { live } from '@electric-sql/pglite/live'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('pglite:config', (options) => {
    // options.username = useUserSession().user?.id

    options.extensions = {
      live,
    }
  })

  nuxtApp.hooks.hookOnce('pglite', async (pg) => {
    await pg.query('CREATE EXTENSION IF NOT EXISTS vector;')
    console.log('pgvector is available?', (await pg.query<any>('SELECT * FROM pg_extension;')).rows.some(e => e.extname === 'vector'))
  })
})

declare module '#pglite-utils' {
  interface PGliteClientExtensions {
    live: typeof live
  }
}
