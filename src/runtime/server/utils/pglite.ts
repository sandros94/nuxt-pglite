import { type PGliteOptions, PGlite } from '@electric-sql/pglite'
import { defu } from 'defu'

import { useRuntimeConfig } from '#imports'

export function usePGlite(options?: PGliteOptions) {
  const { pglite } = useRuntimeConfig()

  const _options = defu(options, pglite)

  const pg = new PGlite(_options)

  return {
    pg,
    db: pg,
  }
}
