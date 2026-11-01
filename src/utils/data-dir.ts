import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'pathe'
import type { PGliteOptions } from '@electric-sql/pglite'

/** The URL schemes PGlite serves from memory or a browser filesystem rather than the disk. */
const NOT_ON_DISK = /^(?:memory|idb|opfs-ahp|memfs2opfs):\/\//

/**
 * The path PGlite stores `dataDir` at on the host filesystem, read as PGlite
 * reads it: a plain path or a `file://` one. `undefined` in memory and in a
 * browser filesystem.
 */
export function hostDataDir(dataDir: string | undefined): string | undefined {
  if (dataDir?.startsWith('file://')) {
    return dataDir.slice('file://'.length) || undefined
  }
  return dataDir && !NOT_ON_DISK.test(dataDir) ? dataDir : undefined
}

/**
 * Creates the missing parents of the data directory the development socket
 * opens, when it is on disk. The module picks `.data/pglite` by default and
 * resolves a `dataDir` against `rootDir`, so it also makes sure that path can
 * be opened: PGlite creates the directory itself, but not its parents.
 */
export async function createDataDirParents(
  config: Pick<PGliteOptions, 'dataDir' | 'fs'>,
): Promise<void> {
  // A custom `fs` takes the place of `dataDir`.
  const directory = config.fs ? undefined : hostDataDir(config.dataDir)
  if (directory) {
    // Resolved as PGlite resolves it, from the working directory.
    await mkdir(dirname(resolve(directory)), { recursive: true })
  }
}
