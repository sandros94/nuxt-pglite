import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MemoryFS } from '@electric-sql/pglite'
import type { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { definePGliteConfig } from '../../../src/runtime/core/config'
import { createTestDatabase, loadPGliteConfig } from '../../../src/runtime/testing'
import type { TestDatabase } from '../../../src/runtime/testing'
import { definePGliteGlobalSetup } from '../../../src/runtime/testing/vitest'

const config = definePGliteConfig({
  extensions: { citext },
  init: async (pg) => {
    await pg.exec('CREATE EXTENSION IF NOT EXISTS citext')
    await pg.exec('CREATE TABLE items (name citext NOT NULL)')
  },
})

async function names(db: TestDatabase): Promise<string[]> {
  const { rows } = await db.pg.query<{ name: string }>('SELECT name FROM items ORDER BY name')
  return rows.map((row) => row.name)
}

async function queryOver(url: string, sql: string): Promise<unknown[]> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return (await client.query(sql)).rows
  } finally {
    await client.end()
  }
}

// A port nothing listens on, once this resolves.
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP address')
  }
  return address.port
}

// None of these is set by the suite's environment; each test starts without them.
const VARIABLES = ['DATABASE_URL', 'NETLIFY_DB_URL', 'NETLIFY_DB_DRIVER']

describe('createTestDatabase', () => {
  beforeEach(() => {
    for (const name of VARIABLES) {
      vi.stubEnv(name, undefined)
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates an in-memory instance from an inline config, init included', async () => {
    const db = await createTestDatabase({ config })
    try {
      await db.pg.query("INSERT INTO items VALUES ('A')")
      // The extension is loaded: citext compares case-insensitively.
      const { rows } = await db.pg.query("SELECT name FROM items WHERE name = 'a'")
      expect(rows).toEqual([{ name: 'A' }])
      expect(db.pg.dataDir).toBe('memory://')
      expect(db.url).toBeUndefined()
      expect(db.env).toEqual({})
    } finally {
      await db.close()
    }
    expect(db.pg.closed).toBe(true)
  })

  it('forks isolated copies of the current state, without running init again', async () => {
    const init = vi.fn<NonNullable<typeof config.init>>(config.init)
    const db = await createTestDatabase({ config: { ...config, init } })
    try {
      await db.pg.query("INSERT INTO items VALUES ('shared')")
      const fork = await db.fork()
      expect(init).toHaveBeenCalledTimes(1)
      expect(await names(fork)).toEqual(['shared'])

      await Promise.all([
        fork.pg.query("INSERT INTO items VALUES ('fork')"),
        db.pg.query("INSERT INTO items VALUES ('parent')"),
      ])
      const [inFork, inParent] = await Promise.all([names(fork), names(db)])
      expect(inFork).toEqual(['fork', 'shared'])
      expect(inParent).toEqual(['parent', 'shared'])

      // Same extensions in the copy.
      const { rows } = await fork.pg.query("SELECT name FROM items WHERE name = 'FORK'")
      expect(rows).toEqual([{ name: 'fork' }])

      await fork.close()
      expect(fork.pg.closed).toBe(true)
      expect(db.pg.closed).toBe(false)
    } finally {
      await db.close()
    }
  })

  it('closes the forks still open with the parent, and refuses to fork once closed', async () => {
    const db = await createTestDatabase({ config })
    const fork = await db.fork()
    await db.close()
    expect(fork.pg.closed).toBe(true)
    await expect(db.fork()).rejects.toThrow(/closed/)
  })

  it('serves the instance over the socket and exports DATABASE_URL while open', async () => {
    const db = await createTestDatabase({ config, socket: true })
    try {
      expect(db.url).toMatch(/^postgres(ql)?:\/\/.+@127\.0\.0\.1:\d+\//)
      expect(db.env).toEqual({ DATABASE_URL: db.url })
      expect(process.env.DATABASE_URL).toBe(db.url)

      await db.pg.query("INSERT INTO items VALUES ('over the wire')")
      expect(await queryOver(db.url!, 'SELECT name FROM items')).toEqual([
        { name: 'over the wire' },
      ])

      // A fork gets its own socket on another port, and exports nothing.
      const fork = await db.fork()
      expect(fork.url).toBeDefined()
      expect(fork.url).not.toBe(db.url)
      expect(fork.env).toEqual({ DATABASE_URL: fork.url })
      expect(process.env.DATABASE_URL).toBe(db.url)
      expect(await queryOver(fork.url!, 'SELECT count(*)::int AS n FROM items')).toEqual([{ n: 1 }])
    } finally {
      await db.close()
    }
    expect(process.env.DATABASE_URL).toBeUndefined()
  })

  it('leaves a variable that is already set alone', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://elsewhere/db')
    const db = await createTestDatabase({ socket: true })
    try {
      expect(db.env.DATABASE_URL).toBe(db.url)
      expect(process.env.DATABASE_URL).toBe('postgres://elsewhere/db')
    } finally {
      await db.close()
    }
    expect(process.env.DATABASE_URL).toBe('postgres://elsewhere/db')
  })

  it("exports a provider's variables in place of DATABASE_URL", async () => {
    const db = await createTestDatabase({ socket: { provider: 'netlify' } })
    try {
      expect(db.env).toEqual({ NETLIFY_DB_URL: db.url, NETLIFY_DB_DRIVER: 'server' })
      expect(process.env.NETLIFY_DB_URL).toBe(db.url)
      expect(process.env.NETLIFY_DB_DRIVER).toBe('server')
      expect(process.env.DATABASE_URL).toBeUndefined()
    } finally {
      await db.close()
    }
    expect(process.env.NETLIFY_DB_URL).toBeUndefined()
    expect(process.env.NETLIFY_DB_DRIVER).toBeUndefined()
  })

  it('leaves a variable set to an empty value alone', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const db = await createTestDatabase({ socket: true })
    try {
      expect(process.env.DATABASE_URL).toBe('')
    } finally {
      await db.close()
    }
    expect(process.env.DATABASE_URL).toBe('')
  })

  it('closes the socket and the instance when an `env` function throws', async () => {
    const port = await freePort()
    const created = vi.fn<(pg: PGlite) => void>()
    await expect(
      createTestDatabase({
        config: { init: created },
        socket: {
          port,
          env: {
            DATABASE_URL: () => {
              throw new Error('no url')
            },
          },
        },
      }),
    ).rejects.toThrow('no url')
    expect(created.mock.calls[0]?.[0]).toMatchObject({ closed: true })
    // The port is free again.
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    await new Promise((resolve) => server.close(resolve))
  })

  it("does not use the config's `fs`, which holds the app's data", async () => {
    const fs = new MemoryFS()
    const db = await createTestDatabase({ config: { fs } })
    try {
      expect(db.pg.fs).not.toBe(fs)
    } finally {
      await db.close()
    }
  })

  it('exports nothing with exportEnv: false', async () => {
    const db = await createTestDatabase({ socket: true, exportEnv: false })
    try {
      expect(db.env).toEqual({ DATABASE_URL: db.url })
      expect(process.env.DATABASE_URL).toBeUndefined()
    } finally {
      await db.close()
    }
  })

  it('closes the instance when init fails', async () => {
    const created = vi.fn<(pg: PGlite) => void>()
    await expect(
      createTestDatabase({
        config: {
          init: (pg) => {
            created(pg)
            throw new Error('seed failed')
          },
        },
      }),
    ).rejects.toThrow('seed failed')
    expect(created.mock.calls[0]?.[0]).toMatchObject({ closed: true })
  })
})

describe('loadPGliteConfig', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nuxt-pglite-testing-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('loads a file written with the global helper, $test applied, extension optional', async () => {
    await writeFile(
      join(directory, 'pglite.config.ts'),
      [
        'export default definePGliteServerConfig({',
        "  init: (pg: { exec(sql: string): Promise<unknown> }) => pg.exec('CREATE TABLE dev (id int)'),",
        "  $development: { init: () => { throw new Error('not in tests') } },",
        "  $test: { init: (pg: { exec(sql: string): Promise<unknown> }) => pg.exec('CREATE TABLE test (id int)') },",
        '})',
      ].join('\n'),
    )

    const loaded = await loadPGliteConfig(join(directory, 'pglite.config'))
    expect(loaded).not.toHaveProperty('$test')
    expect('definePGliteServerConfig' in globalThis).toBe(false)

    const db = await createTestDatabase({ config: join(directory, 'pglite.config.ts') })
    try {
      const { rows } = await db.pg.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
      )
      expect(rows).toEqual([{ tablename: 'test' }])
    } finally {
      await db.close()
    }
  })

  it('reads the file again on every load', async () => {
    const path = join(directory, 'pglite.config.ts')
    await writeFile(path, "export default definePGliteServerConfig({ dataDir: 'first' })")
    expect(await loadPGliteConfig(path)).toMatchObject({ dataDir: 'first' })

    await writeFile(path, "export default definePGliteServerConfig({ dataDir: 'second' })")
    expect(await loadPGliteConfig(path)).toMatchObject({ dataDir: 'second' })
  })

  it('resolves the imports through `alias`, which the file needs outside Nuxt', async () => {
    await mkdir(join(directory, 'shared'))
    await writeFile(
      join(directory, 'shared', 'schema.ts'),
      "export const schema = 'CREATE TABLE aliased (id int)'",
    )
    await writeFile(
      join(directory, 'pglite.config.ts'),
      [
        "import { schema } from '#shared/schema'",
        'export default definePGliteServerConfig({',
        '  init: (pg: { exec(sql: string): Promise<unknown> }) => pg.exec(schema),',
        '})',
      ].join('\n'),
    )
    const path = join(directory, 'pglite.config')

    await expect(loadPGliteConfig(path)).rejects.toThrow(/#shared\/schema/)

    const db = await createTestDatabase({
      config: path,
      alias: { '#shared': join(directory, 'shared') },
    })
    try {
      const { rows } = await db.pg.query("SELECT to_regclass('aliased') IS NOT NULL AS found")
      expect(rows).toEqual([{ found: true }])
    } finally {
      await db.close()
    }
  })

  it('refuses a client config, and a missing file', async () => {
    await writeFile(
      join(directory, 'client.config.mjs'),
      'export default definePGliteClientConfig({})',
    )
    await expect(loadPGliteConfig(join(directory, 'client.config.mjs'))).rejects.toThrow(
      /definePGliteServerConfig/,
    )
    await expect(loadPGliteConfig(join(directory, 'missing'))).rejects.toThrow(/No PGlite config/)
  })
})

describe('definePGliteGlobalSetup', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('serves a database for the run, provides it and tears it down', async () => {
    vi.stubEnv('DATABASE_URL', undefined)
    const provide = vi.fn<(key: string, value: { url: string }) => void>()
    const setup = definePGliteGlobalSetup({ config })

    const teardown = await setup({ provide })
    const [[key, value] = []] = provide.mock.calls
    expect(key).toBe('pglite')
    expect(value).toEqual({ url: process.env.DATABASE_URL, env: { DATABASE_URL: value?.url } })
    expect(await queryOver(value!.url, 'SELECT count(*)::int AS n FROM items')).toEqual([{ n: 0 }])

    await teardown()
    expect(process.env.DATABASE_URL).toBeUndefined()
  })
})
