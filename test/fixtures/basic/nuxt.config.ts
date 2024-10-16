export default defineNuxtConfig({
  modules: [
    '../../../src/module',
  ],

  pglite: {
    client: {
      autoImport: false,
    },
  },
})
