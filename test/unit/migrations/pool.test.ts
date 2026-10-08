import { PGlite } from '@electric-sql/pglite'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'

import { applyMigrations } from '../../../src/runtime/migrations/apply'
import { MigrationError } from '../../../src/runtime/migrations/errors'
import { fromPool, type PoolLike } from '../../../src/runtime/migrations/executor'
import { createPGliteSocketServer } from '../../../src/runtime/socket/server'
import type { PGliteSocketServer } from '../../../src/runtime/socket/server'
import { createMigrationsDir } from './utils'

const FILES = {
  '0001_users/migration.sql': [
    'CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL);',
    "INSERT INTO users (name) VALUES ('ada'), ('grace');",
  ].join('\n'),
  '0002_posts.sql': 'CREATE TABLE posts (id serial PRIMARY KEY, author int REFERENCES users (id));',
}

// What a migrated database holds, to compare one migrated through the pool
// with one migrated directly.
const snapshot = async (db: PGlite) => {
  const [tables, tracked, digests, users] = await Promise.all([
    db.query<{ name: string }>(
      `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables WHERE table_schema IN ('public', 'netlify', 'nuxt_pglite') ORDER BY name`,
    ),
    db.query<{ name: string }>('SELECT name FROM netlify.migrations ORDER BY name'),
    db.query<{ name: string; digest: string }>(
      'SELECT name, digest FROM nuxt_pglite.migration_digest ORDER BY name',
    ),
    db.query<{ name: string }>('SELECT name FROM users ORDER BY id'),
  ])

  return {
    tables: tables.rows,
    tracked: tracked.rows,
    digests: digests.rows,
    users: users.rows,
  }
}

describe('fromPool', () => {
  let db: PGlite
  let server: PGliteSocketServer
  let pool: Pool

  beforeAll(async () => {
    db = new PGlite()
    server = await createPGliteSocketServer(db).listen()
    pool = new Pool({ connectionString: server.url, max: 4 })
  })

  afterAll(async () => {
    await pool.end()
    await server.close()
    await db.close()
  })

  beforeEach(async () => {
    await db.exec(
      'DROP SCHEMA IF EXISTS netlify, nuxt_pglite CASCADE; DROP TABLE IF EXISTS posts, users, tags CASCADE;',
    )
  })

  it('takes a `pg` pool', () => {
    expectTypeOf(pool).toExtend<PoolLike>()
  })

  it('migrates as a direct PGlite does', async () => {
    const dir = await createMigrationsDir(FILES)
    const direct = new PGlite()

    try {
      const [throughPool, directly] = await Promise.all([
        applyMigrations(fromPool(pool), dir),
        applyMigrations(direct, dir),
      ])

      expect(throughPool).toEqual(['0001_users', '0002_posts'])
      expect(directly).toEqual(throughPool)
      expect(await snapshot(db)).toEqual(await snapshot(direct))
      expect(await applyMigrations(fromPool(pool), dir)).toEqual([])
    } finally {
      await direct.close()
    }
  })

  it('rolls back a failing migration and returns its connection', async () => {
    const dir = await createMigrationsDir({
      ...FILES,
      '0003_tags.sql': 'CREATE TABLE tags (name text);\nSELECT 1 / 0;',
    })

    await expect(applyMigrations(fromPool(pool), dir)).rejects.toMatchObject({
      constructor: MigrationError,
      migration: '0003_tags',
    })

    const { rows } = await db.query<{ name: string }>(
      'SELECT name FROM netlify.migrations ORDER BY name',
    )

    expect(rows.map((row) => row.name)).toEqual(['0001_users', '0002_posts'])
    expect(await db.query("SELECT to_regclass('public.tags') AS tags")).toMatchObject({
      rows: [{ tags: null }],
    })
    expect(pool.totalCount).toBe(pool.idleCount)
  })
})
