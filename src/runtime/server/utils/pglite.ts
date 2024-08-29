import { type PGliteOptions, PGlite } from '@electric-sql/pglite'

export function usePGlite(options?: PGliteOptions) {
  const pg = new PGlite(options)

  return {
    pg,
    db: pg,
  }
}
