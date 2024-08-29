// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },

  future: {
    compatibilityVersion: 4,
  },

  extends: ['gh:sandros94/ui/main#b730806'],

  modules: [
    '@nuxt/eslint',
  ],

  eslint: {
    config: {
      stylistic: true,
    },
  },
})
