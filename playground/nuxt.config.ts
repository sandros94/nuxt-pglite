export default defineNuxtConfig({
  compatibilityDate: 'latest',
  devtools: { enabled: true },

  modules: ['nuxt-pglite'],

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

  $test: {
    nitro: {
      preset: 'node-server',
    },
  },
})
