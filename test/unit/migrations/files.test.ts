import { mkdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readMigrations } from '../../../src/runtime/migrations/files'
import { createMigrationsDir } from './utils'

describe('readMigrations', () => {
  it('reads directory and flat migrations, sorted, ignoring anything else', async () => {
    const dir = await createMigrationsDir({
      '20260102000000_posts/migration.sql': 'SELECT 2',
      '20260101000000_users/migration.sql': 'SELECT 1',
      '20260103000000_tags.sql': 'SELECT 3',
      '20260101000000_users/snapshot.json': '{}',
      'meta/_journal.json': '{}',
      'README.md': '# migrations',
      'notes.txt': '',
    })
    await mkdir(join(dir, 'empty'))

    expect(await readMigrations(dir)).toEqual([
      { name: '20260101000000_users', path: join(dir, '20260101000000_users/migration.sql') },
      { name: '20260102000000_posts', path: join(dir, '20260102000000_posts/migration.sql') },
      { name: '20260103000000_tags', path: join(dir, '20260103000000_tags.sql') },
    ])
  })

  it('refuses a name declared in both shapes', async () => {
    const dir = await createMigrationsDir({
      '0001_init/migration.sql': 'SELECT 1',
      '0001_init.sql': 'SELECT 1',
    })

    await expect(readMigrations(dir)).rejects.toThrow('Migration 0001_init is declared twice')
  })

  it('resolves a relative directory from the working directory', async () => {
    const dir = await createMigrationsDir({ '0001_init.sql': 'SELECT 1' })
    expect(await readMigrations(relative(process.cwd(), dir))).toEqual([
      { name: '0001_init', path: join(dir, '0001_init.sql') },
    ])
  })
})
