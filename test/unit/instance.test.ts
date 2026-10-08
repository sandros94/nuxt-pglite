import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetInstance } from '../../src/instance'
import { createInstance } from '../../src/runtime/core/instance'

// Each instance on disk takes a second or more to create.
describe('createInstance and resetInstance', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nuxt-pglite-reset-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('recreates the instance from an empty data directory, running init again', async () => {
    const init = vi.fn<(pg: PGlite) => Promise<void>>(async (pg) => {
      await pg.exec('CREATE TABLE IF NOT EXISTS seeded (id int)')
    })
    const config = { dataDir: join(directory, 'db'), init }
    const db = await createInstance(PGlite, config)
    await db.exec('CREATE TABLE extra (id int)')

    const next = await resetInstance(PGlite, config, () => db.close())
    try {
      expect(db.closed).toBe(true)
      expect(init).toHaveBeenCalledTimes(2)
      const { rows } = await next.query<{ name: string }>(
        "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
      )
      expect(rows).toEqual([{ name: 'seeded' }])
    } finally {
      await next.close()
    }
  }, 30_000)

  it('closes the instance when init fails', async () => {
    const create = vi.spyOn(PGlite, 'create')
    try {
      await expect(
        createInstance(PGlite, {
          dataDir: join(directory, 'db'),
          init: () => Promise.reject(new Error('migration failed')),
        }),
      ).rejects.toThrow('migration failed')
      const created: unknown = await create.mock.results[0]?.value
      expect(created instanceof PGlite && created.closed).toBe(true)
    } finally {
      create.mockRestore()
    }
  })

  it('refuses a browser filesystem before releasing anything', async () => {
    const release = vi.fn<() => Promise<void>>(async () => {})
    await expect(resetInstance(PGlite, { dataDir: 'idb://app' }, release)).rejects.toThrow(
      /not stored on disk/,
    )
    expect(release).not.toHaveBeenCalled()
  })

  it('recreates an in-memory database', async () => {
    const release = vi.fn<() => Promise<void>>(async () => {})
    for (const dataDir of [undefined, 'memory://']) {
      const db = await resetInstance(PGlite, { dataDir }, release)
      expect((await db.query<{ ok: number }>('SELECT 1 AS ok')).rows[0]?.ok).toBe(1)
      await db.close()
    }
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('refuses a directory that does not look like PGlite', async () => {
    const dataDir = join(directory, 'project')
    await mkdir(dataDir)
    await writeFile(join(dataDir, 'package.json'), '{}')
    const release = vi.fn<() => Promise<void>>(async () => {})

    await expect(resetInstance(PGlite, { dataDir }, release)).rejects.toThrow(
      /does not look like a PGlite data directory/,
    )
    expect(release).not.toHaveBeenCalled()
  })
})
