export default defineNuxtConfig({
  compatibilityDate: 'latest',
  devtools: { enabled: true },

  modules: ['nuxt-pglite'],

  pglite: {
    client: {
      enabled: true,
    },
    server: {
      socket: { port: 5433 },
    },
  },

  $test: {
    nitro: {
      preset: 'node-server',
    },
  },
})
