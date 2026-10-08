import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { applyMigrations } from '../../../src/runtime/migrations/apply'
import { MigrationDriftError, MigrationError } from '../../../src/runtime/migrations/errors'
import type { MigrationExecutor } from '../../../src/runtime/migrations/executor'
import { createMigrationsDir, writeFiles } from './utils'

const USERS = 'CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL);'
const POSTS = [
  'CREATE TABLE posts (id serial PRIMARY KEY, author int REFERENCES users (id));',
  'CREATE INDEX posts_author ON posts (author);',
].join('\n')

let db: PGlite

beforeEach(() => {
  db = new PGlite()
})

afterEach(async () => {
  await db.close()
})

const tables = async (schema: string) =>
  (
    await db.query<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [schema],
    )
  ).rows.map((row) => row.table_name)

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('Expected a rejection')
    },
    (error: unknown) => error,
  )

const tracked = async (table = 'netlify.migrations') =>
  (await db.query<{ name: string }>(`SELECT name FROM ${table} ORDER BY name`)).rows.map(
    (row) => row.name,
  )

describe('applyMigrations', () => {
  it('takes PGlite as is', () => {
    expectTypeOf(db).toExtend<MigrationExecutor>()
  })

  it('applies pending migrations once, in order, with their bookkeeping', async () => {
    const dir = await createMigrationsDir({
      '0001_users/migration.sql': USERS,
      '0002_posts.sql': POSTS,
    })

    expect(await applyMigrations(db, dir)).toEqual(['0001_users', '0002_posts'])
    expect(await tables('public')).toEqual(['posts', 'users'])
    expect(await tracked()).toEqual(['0001_users', '0002_posts'])
    expect(await tracked('nuxt_pglite.migration_digest')).toEqual(['0001_users', '0002_posts'])

    expect(await applyMigrations(db, dir)).toEqual([])

    await writeFiles(dir, { '0003_tags/migration.sql': 'CREATE TABLE tags (name text);' })

    expect(await applyMigrations(db, dir)).toEqual(['0003_tags'])
    expect(await tables('public')).toEqual(['posts', 'tags', 'users'])
  })

  it('logs each migration applied', async () => {
    const dir = await createMigrationsDir({ '0001_users.sql': USERS })
    const logger = {
      info: vi.fn<(message: string) => void>(),
      warn: vi.fn<(message: string) => void>(),
    }

    await applyMigrations(db, dir, { logger })

    expect(logger.info).toHaveBeenCalledWith('Applied migration 0001_users')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('lets concurrent appliers take turns, each migration applied once', async () => {
    const dir = await createMigrationsDir({ '0001_users.sql': USERS, '0002_posts.sql': POSTS })

    const results = await Promise.all([applyMigrations(db, dir), applyMigrations(db, dir)])

    // Both read the same pending list; whichever comes second skips them.
    expect(results.flat().toSorted()).toEqual(['0001_users', '0002_posts'])
    expect(await tracked()).toEqual(['0001_users', '0002_posts'])
  })

  describe('target', () => {
    const files = {
      '0001_users.sql': USERS,
      '0002_posts.sql': POSTS,
      '0003_tags.sql': 'CREATE TABLE tags (name text);',
    }

    it('stops at an exact name or a prefix', async () => {
      const dir = await createMigrationsDir(files)

      expect(await applyMigrations(db, dir, { target: '0001_users' })).toEqual(['0001_users'])
      expect(await applyMigrations(db, dir, { target: '0002' })).toEqual(['0002_posts'])
      expect(await applyMigrations(db, dir)).toEqual(['0003_tags'])
    })

    it('refuses a target matching no migration, or several', async () => {
      const dir = await createMigrationsDir({ ...files, '0003_tags_more.sql': 'SELECT 1' })

      await expect(applyMigrations(db, dir, { target: '0004' })).rejects.toThrow(
        'Migration target 0004 matches no migration.',
      )
      await expect(applyMigrations(db, dir, { target: '0003' })).rejects.toThrow(
        'Migration target 0003 is ambiguous: 0003_tags, 0003_tags_more.',
      )
      expect(await applyMigrations(db, dir, { target: '0003_tags' })).toHaveLength(3)
    })
  })

  describe('drift', () => {
    it('refuses an applied migration edited since', async () => {
      const dir = await createMigrationsDir({ '0001_users.sql': USERS, '0002_posts.sql': POSTS })

      await applyMigrations(db, dir)
      await writeFiles(dir, {
        '0002_posts.sql': `${POSTS}\nALTER TABLE posts ADD title text;`,
        '0003_tags.sql': 'CREATE TABLE tags (name text);',
      })

      const error = await rejection(applyMigrations(db, dir))

      expect(error).toBeInstanceOf(MigrationDriftError)
      expect(error).toMatchObject({
        details: [{ name: '0002_posts', reason: 'edited' }],
        message: expect.stringContaining('reset the local database'),
      })
      // Nothing ran.
      expect(await tables('public')).toEqual(['posts', 'users'])
    })

    it('refuses an applied migration removed since', async () => {
      const dir = await createMigrationsDir({
        '0001_users/migration.sql': USERS,
        '0002_posts/migration.sql': POSTS,
      })

      await applyMigrations(db, dir)
      await rm(join(dir, '0002_posts'), { recursive: true })

      await expect(applyMigrations(db, dir)).rejects.toMatchObject({
        name: 'MigrationDriftError',
        details: [{ name: '0002_posts', reason: 'removed' }],
      })
    })

    it('lists every drifted migration', async () => {
      const dir = await createMigrationsDir({ '0001_users.sql': USERS, '0002_posts.sql': POSTS })

      await applyMigrations(db, dir)
      await Promise.all([
        writeFile(join(dir, '0001_users.sql'), `${USERS}\n-- edited`),
        rm(join(dir, '0002_posts.sql')),
      ])

      const error = await rejection(applyMigrations(db, dir))

      expect(error).toMatchObject({
        details: [
          { name: '0001_users', reason: 'edited' },
          { name: '0002_posts', reason: 'removed' },
        ],
        message: expect.stringMatching(/\n {2}- 0001_users: edited\n {2}- 0002_posts: removed\n/),
      })
    })

    it('skips the check with `digests: false`', async () => {
      const dir = await createMigrationsDir({ '0001_users.sql': USERS, '0002_posts.sql': POSTS })

      await applyMigrations(db, dir, { digests: false })
      await writeFiles(dir, { '0001_users.sql': `${USERS}\n-- edited` })
      await rm(join(dir, '0002_posts.sql'))

      expect(await applyMigrations(db, dir, { digests: false })).toEqual([])
      expect(await tables('nuxt_pglite')).toEqual([])
    })

    it('records the digest of migrations applied without one', async () => {
      const dir = await createMigrationsDir({ '0001_users.sql': USERS })
      const logger = {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
      }

      await applyMigrations(db, dir, { digests: false })
      expect(await applyMigrations(db, dir, { logger })).toEqual([])
      expect(await tracked('nuxt_pglite.migration_digest')).toEqual(['0001_users'])
      expect(logger.warn).toHaveBeenCalledOnce()

      await writeFiles(dir, { '0001_users.sql': `${USERS}\n-- edited` })

      await expect(applyMigrations(db, dir)).rejects.toBeInstanceOf(MigrationDriftError)
    })

    it('uses a custom digests table', async () => {
      const dir = await createMigrationsDir({ '0001_users.sql': USERS })

      await applyMigrations(db, dir, { digests: 'app.digests' })

      expect(await tracked('app.digests')).toEqual(['0001_users'])
      expect(await tables('nuxt_pglite')).toEqual([])
    })
  })

  it('rolls back a failing migration and stops there', async () => {
    const dir = await createMigrationsDir({
      '0001_users.sql': USERS,
      '0002_posts.sql': `${POSTS}\nSELECT 1 / 0;`,
      '0003_tags.sql': 'CREATE TABLE tags (name text);',
    })

    const error = await rejection(applyMigrations(db, dir))

    expect(error).toBeInstanceOf(MigrationError)
    expect(error).toMatchObject({
      name: 'MigrationError',
      migration: '0002_posts',
      cause: expect.objectContaining({ message: 'division by zero' }),
    })
    expect(await tables('public')).toEqual(['users'])
    expect(await tracked()).toEqual(['0001_users'])
    expect(await tracked('nuxt_pglite.migration_digest')).toEqual(['0001_users'])
  })

  describe('table', () => {
    it('uses a custom tracking table', async () => {
      const dir = await createMigrationsDir({ '0001_users.sql': USERS })

      await applyMigrations(db, dir, { table: 'app.migrations' })

      expect(await tables('app')).toEqual(['migrations'])
      expect(await tracked('app.migrations')).toEqual(['0001_users'])
      expect(await tables('netlify')).toEqual([])
    })

    it('takes an unqualified tracking table', async () => {
      const dir = await createMigrationsDir({ '0001_users.sql': USERS })

      await applyMigrations(db, dir, { table: 'schema_migrations' })

      expect(await tracked('public.schema_migrations')).toEqual(['0001_users'])
    })

    it.each(['App.Migrations', 'a.b.c', 'migrations"; DROP TABLE users; --', '', 'app.'])(
      'refuses %j before touching the database',
      async (table) => {
        const dir = await createMigrationsDir({ '0001_users.sql': USERS })
        const [exec, transaction] = [vi.spyOn(db, 'exec'), vi.spyOn(db, 'transaction')]

        await expect(applyMigrations(db, dir, { table })).rejects.toThrow('Invalid `table`')
        expect(exec).not.toHaveBeenCalled()
        expect(transaction).not.toHaveBeenCalled()
      },
    )

    it.each([
      { table: 'app.migrations', digests: 'app.migrations' },
      // The same table, spelled differently.
      { table: 'public.migrations', digests: 'migrations' },
    ])('refuses the tracking table as digests table: %j', async (options) => {
      const dir = await createMigrationsDir({ '0001_users.sql': USERS })

      await expect(applyMigrations(db, dir, options)).rejects.toThrow(
        'The digests table cannot be the tracking table',
      )
      // Nothing was created, nothing ran.
      expect(await tables('public')).toEqual([])
    })
  })
})
