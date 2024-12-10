import { live } from '@electric-sql/pglite/live'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('pglite:config', (options) => {
    options.extensions = {
      ...options.extensions,
      live,
    }
  })
})

declare module '#pglite-utils' {
  interface PGliteClientExtensions {
    live: typeof live
  }
}
