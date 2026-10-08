import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { PGlite } from '@electric-sql/pglite'
import { Pool } from 'pg'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPGliteSocketServer } from '../../../src/runtime/socket'
import type { PGliteSocketServer } from '../../../src/runtime/socket'

const exec = promisify(execFile)

/**
 * The clients a dev database must satisfy: each one runs its own flavour of
 * the extended protocol (named statements, pipelining, pools), which is what
 * the ownership scheduler and statement namespacing exist for.
 */
describe('socket server compatibility', () => {
  let db: PGlite
  let server: PGliteSocketServer

  beforeAll(async () => {
    db = new PGlite()
    await db.exec('CREATE TABLE items (id serial PRIMARY KEY, name text NOT NULL)')
    server = await createPGliteSocketServer(db).listen()
  })

  afterAll(async () => {
    await server.close()
    await db.close()
  })

  describe('postgres.js', () => {
    it('runs concurrent prepared queries from a default-sized pool', async () => {
      const sql = postgres(server.url)
      try {
        const results = await Promise.all(
          Array.from(
            { length: 25 },
            (_, i) =>
              sql<{ n: number; label: string }[]>`SELECT ${i}::int AS n, ${`item-${i}`} AS label`,
          ),
        )
        expect(results.map((r) => r[0])).toEqual(
          Array.from({ length: 25 }, (_, i) => ({ n: i, label: `item-${i}` })),
        )
      } finally {
        await sql.end()
      }
    })

    it('keeps concurrent transactions isolated', async () => {
      const sql = postgres(server.url)
      try {
        const seen = await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            sql
              .begin(async (tx) => {
                await tx`INSERT INTO items (name) VALUES (${`tx-${i}`})`
                const [row] = await tx<
                  { count: string }[]
                >`SELECT count(*) FROM items WHERE name = ${`tx-${i}`}`
                if (i % 2) {
                  throw new Error('rollback')
                }
                return row?.count
              })
              .catch((error: unknown) => (error instanceof Error ? error.message : 'unexpected')),
          ),
        )
        expect(seen).toEqual(['1', 'rollback', '1', 'rollback', '1'])
        const rows = await sql<
          { name: string }[]
        >`SELECT name FROM items WHERE name LIKE 'tx-%' ORDER BY name`
        expect(rows.map((r) => r.name)).toEqual(['tx-0', 'tx-2', 'tx-4'])
      } finally {
        await sql.end()
      }
    })
  })

  describe('pg', () => {
    it('runs concurrent parameterized queries and transactions from a pool', async () => {
      const pool = new Pool({ connectionString: server.url, max: 8 })
      try {
        const queries = Array.from({ length: 20 }, (_, i) =>
          pool
            .query<{ n: number }>({ name: 'pick', text: 'SELECT $1::int AS n', values: [i] })
            .then((r) => r.rows[0]?.n),
        )
        const transactions = Array.from({ length: 4 }, async (_, i) => {
          const client = await pool.connect()
          try {
            await client.query('BEGIN')
            await client.query('INSERT INTO items (name) VALUES ($1)', [`pool-${i}`])
            await client.query(i % 2 ? 'ROLLBACK' : 'COMMIT')
          } finally {
            client.release()
          }
        })
        expect(await Promise.all(queries)).toEqual(Array.from({ length: 20 }, (_, i) => i))
        await Promise.all(transactions)

        const { rows } = await pool.query<{ name: string }>(
          "SELECT name FROM items WHERE name LIKE 'pool-%' ORDER BY name",
        )
        expect(rows.map((r) => r.name)).toEqual(['pool-0', 'pool-2'])
      } finally {
        await pool.end()
      }
    })
  })

  describe('psql', () => {
    it('runs a script', async () => {
      const { stdout } = await exec('psql', [
        server.url,
        '-Atq',
        '-c',
        'SELECT 1 + 1',
        '-c',
        "SELECT 'psql'",
      ])
      expect(stdout.trim().split('\n')).toEqual(['2', 'psql'])
    })
  })

  describe('drizzle-kit', () => {
    it('pushes a schema', async () => {
      // Inside the workspace so that `drizzle-orm` resolves from the schema file.
      const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/nuxt-pglite-drizzle-'))
      try {
        await writeFile(
          join(dir, 'schema.ts'),
          [
            `import { integer, pgSchema, serial, text } from 'drizzle-orm/pg-core'`,
            `export const app = pgSchema('app')`,
            `export const users = app.table('users', { id: serial('id').primaryKey(), name: text('name').notNull(), age: integer('age') })`,
            `export const posts = app.table('posts', { id: serial('id').primaryKey(), author: integer('author').references(() => users.id), title: text('title') })`,
          ].join('\n'),
        )
        await writeFile(
          join(dir, 'drizzle.config.ts'),
          `export default { dialect: 'postgresql', schema: './schema.ts', schemaFilter: ['app'], dbCredentials: { url: ${JSON.stringify(server.url)} } }`,
        )
        const bin = join(process.cwd(), 'node_modules/.bin/drizzle-kit')
        await exec(bin, ['push', '--force', '--config', join(dir, 'drizzle.config.ts')], {
          cwd: dir,
        })

        const { rows } = await db.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY table_name`,
        )
        expect(rows.map((r) => r.table_name)).toEqual(['posts', 'users'])
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }, 60_000)
  })
})
