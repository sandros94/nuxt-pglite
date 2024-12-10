export default defineNuxtConfig({
  modules: ['../src/module'],
  imports: { autoImport: true },

  devtools: { enabled: true },
  future: {
    compatibilityVersion: 4,
  },
  compatibilityDate: '2024-08-29',

  pglite: {
    client: {
      extensions: ['live', 'vector'],
      options: {
        // dataDir: 'memory://nuxt-pglite',
        dataDir: 'idb://nuxt-pglite',
        // dataDir: 'opfs-ahp://nuxt-pglite',
      },
    },
    server: {
      options: {
        // dataDir: 'memory://nuxt-pglite',
        dataDir: './database/pglite',
      },
    },
  },
})
