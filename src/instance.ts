import { access, lstat, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'pathe'
import type { PGlite } from '@electric-sql/pglite'

import type { PGliteConfig } from './runtime/core/config'
import { createInstance } from './runtime/core/instance'
import type { PGliteClass } from './runtime/core/instance'

/**
 * Recreates the instance from an empty data directory, `init` included:
 * `release` lets go of the current instance, closing it, then the directory
 * is removed. An in-memory database is simply recreated; a data directory
 * that is neither is refused before anything is released.
 */
export async function resetInstance(
  PGlite: PGliteClass,
  config: PGliteConfig,
  release: () => Promise<void>,
): Promise<PGlite> {
  const dataDir = await removableDataDir(config.dataDir)
  await release()
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true })
  }
  return createInstance(PGlite, config)
}

/**
 * The directory to remove, `undefined` when there is none (in memory, or not
 * created yet). Refuses a browser filesystem and a directory that does not
 * look like PGlite's, so that a mistyped `dataDir` never deletes unrelated
 * files.
 */
async function removableDataDir(dataDir: string | undefined): Promise<string | undefined> {
  const path = dataDir?.startsWith('file://') ? dataDir.slice('file://'.length) : dataDir
  // In memory: nothing to remove, recreating the instance empties it.
  if (!path || path.startsWith('memory://')) {
    return undefined
  }
  if (/^[a-z-]+:\/\//.test(path)) {
    throw new Error(
      `The database is not stored on disk (\`dataDir\`: ${dataDir}), so it cannot be reset here.`,
    )
  }
  const directory = resolve(path)
  const stats = await lstat(directory).catch(() => undefined)
  if (!stats) {
    return undefined
  }
  if (!stats.isDirectory()) {
    throw new Error(`${directory} is not a directory, so it is not reset.`)
  }
  // Every Postgres data directory has this file; an empty one is left over
  // from a failed creation.
  const isPGlite = await access(join(directory, 'PG_VERSION')).then(
    () => true,
    () => false,
  )
  if (!isPGlite && (await readdir(directory)).length > 0) {
    throw new Error(`${directory} does not look like a PGlite data directory, so it is not reset.`)
  }
  return directory
}
