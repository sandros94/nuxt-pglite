export default defineNuxtConfig({
  modules: [
    '../../../src/module',
  ],

  pglite: {
    client: {
      enabled: false,
    },
  },
})
