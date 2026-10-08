import type { PGlite } from '@electric-sql/pglite'

import type { PGliteConfig } from './config'

/** The PGlite class, as loaded by the caller from its own dependencies. */
export type PGliteClass = Pick<typeof PGlite, 'create'>

/**
 * Creates the instance and runs `init` on it, eagerly rather than through a
 * provider: the development socket, its reset and the testing entry share
 * this path. A failed `init` closes the instance, which would otherwise hold
 * its data directory.
 */
export async function createInstance(PGlite: PGliteClass, config: PGliteConfig): Promise<PGlite> {
  const db = await PGlite.create(config)
  try {
    await config.init?.(db)
  } catch (error) {
    await db.close().catch(() => {})
    throw error
  }
  return db
}
