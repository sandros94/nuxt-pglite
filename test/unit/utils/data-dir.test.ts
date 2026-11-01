import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MemoryFS } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDataDirParents, hostDataDir } from '../../../src/utils/data-dir'

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

describe('hostDataDir', () => {
  it('reads a plain path and a `file://` one as PGlite does', () => {
    expect(hostDataDir('.data/pglite')).toBe('.data/pglite')
    expect(hostDataDir('/var/lib/pglite')).toBe('/var/lib/pglite')
    expect(hostDataDir('file://.data/pglite')).toBe('.data/pglite')
  })

  it('has no path for an in-memory or browser data directory', () => {
    const dataDirs = [
      undefined,
      '',
      'memory://',
      'memory://app',
      'idb://app',
      'opfs-ahp://app',
      'memfs2opfs://app',
    ]
    expect(dataDirs.map(hostDataDir)).toEqual(dataDirs.map(() => undefined))
  })
})

describe('createDataDirParents', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nuxt-pglite-data-dir-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('creates the missing parents of a data directory on disk, not the directory', async () => {
    await createDataDirParents({ dataDir: join(directory, 'a', 'b', 'pglite') })
    expect(await exists(join(directory, 'a', 'b'))).toBe(true)
    expect(await exists(join(directory, 'a', 'b', 'pglite'))).toBe(false)

    await createDataDirParents({ dataDir: `file://${join(directory, 'c', 'pglite')}` })
    expect(await exists(join(directory, 'c'))).toBe(true)
  })

  it('leaves the disk alone when a custom `fs` takes the place of `dataDir`', async () => {
    await createDataDirParents({ dataDir: join(directory, 'a', 'pglite'), fs: new MemoryFS() })
    expect(await exists(join(directory, 'a'))).toBe(false)
  })
})
