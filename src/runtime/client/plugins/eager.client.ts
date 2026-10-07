import { defineNuxtPlugin } from '#imports'

import { pglite } from '../pglite'

// Registered only with `client.eager`: starts the worker as soon as the app
// loads instead of on the first `usePGlite()`.
export default defineNuxtPlugin({
  name: 'nuxt-pglite:eager',
  parallel: true,
  env: { islands: false },
  setup() {
    void pglite.use()
  },
})
