import { type PGliteOptions, PGlite } from '@electric-sql/pglite'
import { defu } from 'defu'

import { useRuntimeConfig } from '#imports'

let _pglite: PGlite | undefined
export function usePGlite(options?: PGliteOptions) {
  if (!_pglite) {
    const { pglite: { autoImport, ...pglite } } = useRuntimeConfig()
    const opts = defu<PGliteOptions, PGliteOptions[]>(options, pglite)
    _pglite = new PGlite(opts)
  }

  return _pglite
}
