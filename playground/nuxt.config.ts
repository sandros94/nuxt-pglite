export default defineNuxtConfig({
  modules: ['nuxt-pglite'],
  imports: { autoImport: true },

  devtools: { enabled: true },
  compatibilityDate: '2024-08-29',

  pglite: {
    client: {
      dataDir: 'idb://nuxt-pglite',
    },
    server: {
      dataDir: './database/pglite',
    },
  },
})
