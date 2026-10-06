// Explicit import: fixtures are prepared by `pnpm dev:prepare`, but keeping
// the import here means the file also type-checks on a cold checkout.
import { defineNuxtConfig } from 'nuxt/config'
import PGlite from '../../../src/module'

export default defineNuxtConfig({
  compatibilityDate: 'latest',

  modules: [PGlite],

  pglite: {
    client: {
      enabled: false,
    },
    server: {
      extensions: ['citext'],
    },
  },
})
