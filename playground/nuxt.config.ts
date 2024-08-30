export default defineNuxtConfig({
  modules: ['nuxt-pglite'],

  pglite: {
    client: {
      dataDir: 'idb://nuxt-pglite',
    },
    server: {
      dataDir: './database/pglite',
    },
  },

  devtools: { enabled: true },
  imports: { autoImport: true },
  compatibilityDate: '2024-08-29',
})
