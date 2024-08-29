export default defineNuxtConfig({
  modules: ['nuxt-pglite'],

  pglite: {
    client: {
      debug: 1,
      dataDir: 'idb://nuxt-pglite',
    },
    server: {
      dataDir: './playground/server/database',
    },
  },

  devtools: { enabled: true },
  imports: { autoImport: true },
  compatibilityDate: '2024-08-29',
})
