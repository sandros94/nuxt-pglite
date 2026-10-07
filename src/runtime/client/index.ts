/**
 * Everything the browser side of a Nuxt app gets from the module, also
 * reachable as `#pglite/client`.
 */
export { definePGliteClientConfig } from './config'
export type { PGliteClientConfig, PGliteClientInstanceFor } from './config'
export { pglite, usePGlite } from './pglite'
export { useLiveIncrementalQuery, useLiveQuery } from './live-query'
