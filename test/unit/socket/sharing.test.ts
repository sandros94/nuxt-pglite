import { connect } from 'node:net'

import { PGlite } from '@electric-sql/pglite'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createPGliteSocketServer } from '../../../src/runtime/socket'
import type { PGliteSocketServer } from '../../../src/runtime/socket'
import { splitMessages } from '../../../src/runtime/socket/protocol'

/**
 * What goes wrong when several clients, and the process itself, share one
 * PGlite session: these are the cases an adversarial review turned up.
 */
describe('sharing one PGlite session', () => {
  let db: PGlite
  let server: PGliteSocketServer
  const clients: Client[] = []

  const tcpPort = () => {
    const { address } = server
    if (!address || !('host' in address)) {
      throw new Error('Expected a TCP address')
    }
    return address.port
  }

  const connectClient = async () => {
    const client = new Client({ connectionString: server.url })
    clients.push(client)
    await client.connect()
    return client
  }

  beforeAll(async () => {
    db = new PGlite()
    await db.exec('CREATE TABLE shared (id int)')
    server = await createPGliteSocketServer(db, { idleInTransactionTimeout: 150 }).listen()
  })

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)))
    clients.length = 0
  })

  afterAll(async () => {
    await server.close()
    await db.close()
  })

  it('refuses COPY FROM STDIN instead of freezing the process', async () => {
    const client = await connectClient()
    await expect(client.query('COPY shared FROM STDIN')).rejects.toMatchObject({ code: '0A000' })
    expect((await client.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }])

    await client.query('BEGIN')
    await expect(client.query('COPY shared FROM STDIN')).rejects.toMatchObject({ code: '0A000' })
    await expect(client.query('SELECT 1')).rejects.toMatchObject({ code: '25P02' })
    await client.query('ROLLBACK')
  })

  it("keeps a client's statement out of the app's in-process transaction", async () => {
    const client = await connectClient()

    const appTransaction = db.transaction(async (tx) => {
      await tx.query('INSERT INTO shared VALUES (1)')
      await new Promise((resolve) => setTimeout(resolve, 100))
      await tx.rollback()
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await client.query('INSERT INTO shared VALUES (2)')
    await appTransaction

    expect((await db.query<{ id: number }>('SELECT id FROM shared')).rows).toEqual([{ id: 2 }])
    await db.exec('DELETE FROM shared')
  })

  it("keeps the app's statement out of a client's transaction", async () => {
    const client = await connectClient()
    await client.query('BEGIN')
    await client.query('INSERT INTO shared VALUES (3)')

    const seen = db.query<{ n: number }>('SELECT count(*)::int AS n FROM shared')
    await new Promise((resolve) => setTimeout(resolve, 50))
    await client.query('ROLLBACK')

    expect((await seen).rows).toEqual([{ n: 0 }])
  })

  it('keeps other listeners when a client UNLISTENs through the extended protocol', async () => {
    const keeper = await connectClient()
    const leaver = await connectClient()
    const notifier = await connectClient()
    const received: string[] = []
    keeper.on('notification', ({ payload = '' }) => received.push(payload))

    await keeper.query('LISTEN ext_channel')
    await leaver.query('LISTEN ext_channel')
    await leaver.query({ name: 'unlisten', text: 'UNLISTEN ext_channel' })
    await notifier.query("NOTIFY ext_channel, 'kept'")

    await vi.waitFor(() => expect(received).toEqual(['kept']))
  })

  it('disconnects an owner stuck mid-pipeline so the others get through', async () => {
    const stuck = connect({ host: '127.0.0.1', port: tcpPort() })
    await new Promise((resolve) => stuck.once('connect', resolve))
    const startup = Buffer.concat([
      Buffer.alloc(8),
      Buffer.from('user\0postgres\0database\0postgres\0\0'),
    ])
    startup.writeInt32BE(startup.length, 0)
    startup.writeInt32BE(196608, 4)
    stuck.write(startup)
    await new Promise((resolve) => setTimeout(resolve, 50))
    // Parse without a Sync: a pipeline that never completes.
    const parse = Buffer.concat([
      Buffer.from('P'),
      Buffer.alloc(4),
      Buffer.from('\0SELECT 1\0\0\0'),
    ])
    parse.writeInt32BE(parse.length - 1, 1)
    stuck.write(parse)

    const other = await connectClient()
    expect((await other.query('SELECT 2 AS ok')).rows).toEqual([{ ok: 2 }])
    stuck.destroy()
  })

  it("restores the app's session settings after a client disconnects", async () => {
    const own = new PGlite()
    await own.exec('SET search_path TO pg_catalog, public')
    const ownServer = await createPGliteSocketServer(own).listen()
    try {
      const client = new Client({ connectionString: ownServer.url })
      await client.connect()
      await client.query("SET search_path TO 'client_only'")
      await client.end()
      await vi.waitFor(async () => {
        const { rows } = await own.query<{ search_path: string }>('SHOW search_path')
        expect(rows[0]?.search_path).toBe('pg_catalog, public')
      })
    } finally {
      await ownServer.close()
      await own.close()
    }
  })

  it('runs the messages a client queued before its Terminate', async () => {
    const holder = await connectClient()
    await holder.query('BEGIN')

    const raw = connect({ host: '127.0.0.1', port: tcpPort() })
    await new Promise((resolve) => raw.once('connect', resolve))
    const startup = Buffer.concat([Buffer.alloc(8), Buffer.from('user\0postgres\0\0')])
    startup.writeInt32BE(startup.length, 0)
    startup.writeInt32BE(196608, 4)
    raw.write(startup)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const insert = Buffer.concat([
      Buffer.from('Q'),
      Buffer.alloc(4),
      Buffer.from('INSERT INTO shared VALUES (9)\0'),
    ])
    insert.writeInt32BE(insert.length - 1, 1)
    raw.end(Buffer.concat([insert, Buffer.from([0x58, 0, 0, 0, 4])]))

    await new Promise((resolve) => setTimeout(resolve, 50))
    await holder.query('COMMIT')

    await vi.waitFor(async () => {
      const { rows } = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM shared WHERE id = 9',
      )
      expect(rows).toEqual([{ n: 1 }])
    })
    await db.exec('DELETE FROM shared')
  })

  it('keeps SQL-level prepared statements per client', async () => {
    const a = await connectClient()
    const b = await connectClient()

    await a.query('PREPARE pick (int) AS SELECT $1 AS v')
    await b.query('PREPARE pick (int) AS SELECT $1 * 10 AS v')
    expect((await a.query('EXECUTE pick(1)')).rows).toEqual([{ v: 1 }])
    expect((await b.query('EXECUTE pick(1)')).rows).toEqual([{ v: 10 }])

    await b.query({ name: 'cached', text: 'SELECT 7 AS v' })
    await a.query('DEALLOCATE ALL')
    expect((await b.query('EXECUTE pick(2)')).rows).toEqual([{ v: 20 }])
    expect((await b.query({ name: 'cached', text: 'SELECT 7 AS v' })).rows).toEqual([{ v: 7 }])
    await expect(a.query('EXECUTE pick(1)')).rejects.toMatchObject({ code: '26000' })
  })

  it('keeps long prepared-statement names apart', async () => {
    const client = await connectClient()
    const base = 'a'.repeat(62)
    expect((await client.query({ name: `${base}a`, text: 'SELECT 1 AS v' })).rows).toEqual([
      { v: 1 },
    ])
    expect((await client.query({ name: `${base}b`, text: 'SELECT 2 AS v' })).rows).toEqual([
      { v: 2 },
    ])
  })
})

describe('message framing limits', () => {
  it('rejects a message claiming more than 1 GiB', () => {
    const header = Buffer.from([0x51, 0x7f, 0xff, 0xff, 0xff])
    expect(() => splitMessages(header)).toThrow(/Invalid length/)
  })
})
