/**
 * Everything the server side of a Nuxt app gets from the module, also
 * reachable as `#pglite/server`.
 */
export { definePGliteConfig as definePGliteServerConfig } from '../core'
export type { PGliteConfig, PGliteInstanceFor, PGliteServerAction } from '../core'
export { pglite, usePGlite } from './utils/pglite'
