export default defineNuxtConfig({
  modules: ['../src/module'],
  imports: { autoImport: true },

  devtools: { enabled: true },
  compatibilityDate: '2024-08-29',

  pglite: {
    client: {
      extensions: ['live'],
      options: {
        dataDir: 'idb://nuxt-pglite',
      },
    },
    server: {
      options: {
        dataDir: './database/pglite',
      },
    },
  },
})
