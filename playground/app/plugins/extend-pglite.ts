export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('pglite:config', (_options) => {
    // options.username = useUserSession().user?.id
  })

  nuxtApp.hooks.hookOnce('pglite', async (pg) => {
    await pg.query('CREATE EXTENSION IF NOT EXISTS vector;')
    console.log('pgvector is available?', (await pg.query<any>('SELECT * FROM pg_extension;')).rows.some(e => e.extname === 'vector'))
  })
})
