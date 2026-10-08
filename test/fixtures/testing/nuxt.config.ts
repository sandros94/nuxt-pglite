// Explicit import: fixtures are prepared by `pnpm dev:prepare`, but keeping
// the import here means the file also type-checks on a cold checkout.
import { defineNuxtConfig } from 'nuxt/config'
import PGlite from '../../../src/module'

// An app that reaches its database through `DATABASE_URL` only: the socket
// serves PGlite in `nuxt dev`, a test database serves it in the tests.
export default defineNuxtConfig({
  compatibilityDate: 'latest',

  modules: [PGlite],

  pglite: {
    server: {
      enabled: false,
    },
    socket: true,
  },
})
