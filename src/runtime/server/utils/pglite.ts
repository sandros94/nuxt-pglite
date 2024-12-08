import { type PGliteOptions, PGlite } from '@electric-sql/pglite'
import { defu } from 'defu'

import { useRuntimeConfig } from '#imports'

let pglite: PGlite | undefined
export function usePGlite(options?: PGliteOptions) {
  if (!pglite) {
    const opts = defu<PGliteOptions, PGliteOptions[]>(options, useRuntimeConfig().pglite)
    pglite = new PGlite(opts)
  }

  return pglite
}
