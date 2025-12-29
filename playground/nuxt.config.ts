export default defineNuxtConfig({
  modules: ['../src/module'],
  imports: { autoImport: true },

  devtools: { enabled: true },
  future: {
    compatibilityVersion: 4,
  },
  compatibilityDate: '2025-12-31',

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
        dataDir: '.data/pglite',
      },
    },
  },
})
