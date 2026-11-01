import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, lstatSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { Socket, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { Client, type ClientConfig } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createPGliteSocketServer, type PGliteSocketServer } from '../../../src/runtime/socket'

const clients: Client[] = []
const sockets: Socket[] = []

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const createClient = (config: string | ClientConfig) => {
  const client = new Client(config)

  clients.push(client)

  return client
}

const connectClient = async (server: PGliteSocketServer) => {
  const client = createClient(server.url)

  await client.connect()

  return client
}

// A client that comes, runs a query and leaves while others stay connected.
const visitAndLeave = async (server: PGliteSocketServer) => {
  const visitor = await connectClient(server)

  await visitor.query('SELECT 1')
  await visitor.end()
}

// Resolves with the first error a client receives outside of a query, e.g.
// when the server terminates its connection. The listener stays, as `pg`
// reports the closed connection as another error.
const firstError = (client: Client) =>
  new Promise<Error & { code?: string }>((resolve) => {
    client.on('error', resolve)
  })

const tcpAddress = (server: PGliteSocketServer) => {
  const { address } = server

  if (!address || !('host' in address)) {
    throw new Error('Expected a TCP address')
  }

  return address
}

const frontendMessage = (type: string, ...body: Buffer[]) => {
  const payload = Buffer.concat(body)
  const header = Buffer.alloc(5)

  header.write(type)
  header.writeInt32BE(4 + payload.length, 1)

  return Buffer.concat([header, payload])
}

const text = (value: string) => Buffer.from(`${value}\0`)
const closeStatement = (name: string) => frontendMessage('C', Buffer.from('S'), text(name))
const int16 = (value: number) => Buffer.from([value >> 8, value & 0xff])

// Speaks the wire protocol directly, to control how messages are split and
// timed.
const connectRaw = async (server: PGliteSocketServer) => {
  const { host, port } = tcpAddress(server)
  const socket = connect({ host, port })
  let received = Buffer.alloc(0)

  sockets.push(socket)

  socket.on('data', (chunk: Buffer) => {
    received = Buffer.concat([received, chunk])
  })

  await once(socket, 'connect')

  // Resolves with the backend messages received up to the first one of `type`.
  const readUntil = async (type: string) => {
    for (;;) {
      const messages: { type: string; body: Buffer }[] = []
      let offset = 0

      while (received.length - offset >= 5) {
        const end = offset + 1 + received.readInt32BE(offset + 1)

        if (end > received.length) {
          break
        }

        messages.push({
          type: String.fromCharCode(received.readUInt8(offset)),
          body: received.subarray(offset + 5, end),
        })
        offset = end

        if (messages.at(-1)?.type === type) {
          received = received.subarray(offset)

          return messages
        }
      }

      await once(socket, 'data')
    }
  }

  const startup = Buffer.concat([Buffer.alloc(8), text('user'), text('postgres'), Buffer.alloc(1)])

  startup.writeInt32BE(startup.length, 0)
  startup.writeInt32BE(196608, 4)
  socket.write(startup)

  // BackendKeyData: Int32(process id) | Int32(secret key)
  const key = (await readUntil('Z')).find(({ type }) => type === 'K')?.body ?? Buffer.alloc(8)

  return {
    socket,
    readUntil,
    processId: key.readInt32BE(0),
    secretKey: key.readInt32BE(4),
    query: (sql: string) => frontendMessage('Q', text(sql)),
    parse: (name: string, sql: string) => frontendMessage('P', text(name), text(sql), int16(0)),
    bind: (statement: string) =>
      frontendMessage('B', text(''), text(statement), int16(0), int16(0), int16(0)),
    execute: () => frontendMessage('E', text(''), Buffer.alloc(4)),
    sync: () => frontendMessage('S'),
  }
}

interface BackendKey {
  processId: number
  secretKey: number
}

// Connects a client, along with the BackendKeyData it received.
const connectKeyed = async (server: PGliteSocketServer) => {
  const client = createClient(server.url)
  const key: BackendKey = { processId: 0, secretKey: 0 }

  client.connection.on('backendKeyData', (message: { processID: number; secretKey: number }) => {
    key.processId = message.processID
    key.secretKey = message.secretKey
  })

  await client.connect()

  return { client, key }
}

// Sends a CancelRequest on a connection of its own, the way drivers do, and
// resolves once the server has closed that connection.
const sendCancel = async (server: PGliteSocketServer, { processId, secretKey }: BackendKey) => {
  const { host, port } = tcpAddress(server)
  const socket = connect({ host, port })
  const packet = Buffer.alloc(16)

  sockets.push(socket)
  packet.writeInt32BE(16, 0)
  packet.writeInt32BE(80877102, 4)
  packet.writeInt32BE(processId, 8)
  packet.writeInt32BE(secretKey, 12)

  await once(socket, 'connect')
  socket.end(packet)
  await once(socket, 'close')
}

// Settles with what `promise` settles with, or with 'pending' if it is still
// pending after `ms`.
const within = <T>(promise: Promise<T>, ms = 500) =>
  Promise.race([promise, sleep(ms).then(() => 'pending' as const)])

const messageTypes = (messages: { type: string }[]) => messages.map(({ type }) => type).join('')

// Runs the same named statement repeatedly, with SQL that differs per client.
const runNamed = async (client: Client, sql: string) => {
  const values: number[] = []

  for (let i = 0; i < 10; i++) {
    const result = await client.query<{ v: number }>({ name: 'q', text: sql })

    values.push(...result.rows.map(({ v }) => v))
  }

  return values
}

// Records the notifications a client receives.
const collect = (client: Client) => {
  const received: { channel: string; payload: string }[] = []

  client.on('notification', ({ channel, payload = '' }) => {
    received.push({ channel, payload })
  })

  return received
}

afterEach(async () => {
  // `end()` resolves immediately for a client that never connected or is
  // already closed, so every registered client can be closed unconditionally.
  await Promise.all(clients.map((client) => client.end()))
  clients.length = 0

  for (const socket of sockets) {
    socket.destroy()
  }

  sockets.length = 0
})

describe('createPGliteSocketServer', () => {
  let db: PGlite
  let server: PGliteSocketServer

  beforeAll(async () => {
    db = new PGlite()
    server = await createPGliteSocketServer(db).listen()
  })

  afterAll(async () => {
    await server.close()
    await db.close()
  })

  // The client's statements PGlite has, by their unprefixed name.
  const prepared = async (processId: number) => {
    const { rows } = await db.query<{ name: string }>('SELECT name FROM pg_prepared_statements')
    const prefix = `${String(processId)}_`

    return rows
      .filter(({ name }) => name.startsWith(prefix))
      .map(({ name }) => name.slice(prefix.length))
  }

  it('reports its address and url', () => {
    const { host, port } = tcpAddress(server)

    expect(host).toBe('127.0.0.1')
    expect(port).toBeGreaterThan(0)
    expect(server.url).toBe(`postgres://postgres@127.0.0.1:${String(port)}/postgres`)
  })

  it('counts the open client sockets', async () => {
    const client = await connectClient(server)

    expect(server.connections).toBe(1)

    await client.end()
    await vi.waitFor(() => expect(server.connections).toBe(0))
  })

  it('answers queries from concurrent clients', async () => {
    const client1 = await connectClient(server)
    const client2 = await connectClient(server)

    await client1.query('CREATE TABLE concurrent_test (id SERIAL PRIMARY KEY, value TEXT)')
    await client1.query('INSERT INTO concurrent_test (value) VALUES ($1)', ['from client 1'])
    await client2.query('INSERT INTO concurrent_test (value) VALUES ($1)', ['from client 2'])

    const [result1, result2] = await Promise.all([
      client1.query('SELECT value FROM concurrent_test ORDER BY id'),
      client2.query('SELECT value FROM concurrent_test ORDER BY id'),
    ])

    expect(result1.rows).toEqual([{ value: 'from client 1' }, { value: 'from client 2' }])
    expect(result2.rows).toEqual(result1.rows)
  })

  it('reports the server settings of PGlite during the handshake', async () => {
    const client = createClient(server.url)
    const parameters = new Map<string, string>()

    client.connection.on(
      'parameterStatus',
      (message: { parameterName: string; parameterValue: string }) => {
        parameters.set(message.parameterName, message.parameterValue)
      },
    )

    await client.connect()

    const result = await client.query<{ server_version: string }>('SHOW server_version')

    expect(parameters.get('server_version')).toBe(result.rows[0]?.server_version)
    expect(parameters.get('client_encoding')).toBe('UTF8')
    expect(parameters.get('standard_conforming_strings')).toBe('on')
  })

  it('sets TCP_NODELAY on accepted sockets', async () => {
    const setNoDelay = vi.spyOn(Socket.prototype, 'setNoDelay')

    try {
      const { host, port } = tcpAddress(server)
      const socket = connect({ host, port })

      sockets.push(socket)
      await once(socket, 'connect')

      // The accepted socket is the one whose remote end is the client.
      await vi.waitFor(() => {
        const accepted = setNoDelay.mock.contexts.findIndex(
          (context) =>
            context instanceof Socket &&
            context.remotePort === socket.localPort &&
            context.localPort === port,
        )

        expect(accepted).not.toBe(-1)
        expect(setNoDelay.mock.calls[accepted]).toEqual([true])
      })
    } finally {
      setNoDelay.mockRestore()
    }
  })

  it('keeps concurrent extended-protocol queries from different clients apart', async () => {
    const connected = await Promise.all([0, 1, 2].map(() => connectClient(server)))

    // Each client runs its queries in sequence, while the clients run in
    // parallel so that their Parse/Bind/Execute/Sync pipelines interleave. The
    // SQL differs per client, so binding to another client's unnamed statement
    // would show up in the results.
    const results = await Promise.all(
      connected.map(async (client, c) => {
        const rows: { v: number; c: number }[] = []

        for (let i = 0; i < 20; i++) {
          const result = await client.query<{ v: number; c: number }>(
            `SELECT $1::int AS v, ${String(c)} AS c`,
            [i],
          )

          rows.push(...result.rows)
        }

        return rows
      }),
    )

    expect(results).toEqual([0, 1, 2].map((c) => Array.from({ length: 20 }, (_, v) => ({ v, c }))))
  })

  it('namespaces prepared statements per client', async () => {
    const client1 = await connectClient(server)
    const client2 = await connectClient(server)

    const [first, second] = await Promise.all([
      runNamed(client1, 'SELECT 1 AS v'),
      runNamed(client2, 'SELECT 2 AS v'),
    ])

    expect(first).toEqual(Array.from({ length: 10 }, () => 1))
    expect(second).toEqual(Array.from({ length: 10 }, () => 2))
  })

  it('keeps a pipeline exclusive until its Sync', async () => {
    const raw = await connectRaw(server)
    const client = await connectClient(server)

    raw.socket.write(raw.parse('', 'SELECT 1 AS v'))

    const other = client.query<{ v: number }>('SELECT 2 AS v')

    await sleep(50)

    raw.socket.write(Buffer.concat([raw.bind(''), raw.execute(), raw.sync()]))

    const messages = await raw.readUntil('Z')
    const dataRow = messages.find(({ type }) => type === 'D')

    // DataRow: Int16(columns) | Int32(length) | value
    expect(dataRow?.body.subarray(6).toString()).toBe('1')
    expect(messages.at(-1)?.body.toString()).toBe('I')
    expect((await other).rows).toEqual([{ v: 2 }])
  })

  it('closes the prepared statements of a client that disconnects', async () => {
    const client1 = await connectClient(server)
    const client2 = await connectClient(server)

    await client1.query({ name: 'cleanup', text: 'SELECT 1 AS v' })

    const statements = async () => {
      const { rows } = await client2.query<{ name: string }>(
        `SELECT name FROM pg_prepared_statements WHERE name LIKE '%\\_cleanup'`,
      )

      return rows.map(({ name }) => name)
    }

    expect(await statements()).toEqual([expect.stringMatching(/^\d+_cleanup$/)])

    await client1.end()
    await vi.waitFor(async () => expect(await statements()).toEqual([]))
  })

  describe('prepared statement cleanup', () => {
    it('closes a statement whose cancelled Close never ran, once the client leaves', async () => {
      const holder = await connectClient(server)
      const raw = await connectRaw(server)

      raw.socket.write(Buffer.concat([raw.parse('cancelled', 'SELECT 1'), raw.sync()]))
      await raw.readUntil('Z')
      await holder.query('BEGIN')

      raw.socket.write(Buffer.concat([closeStatement('cancelled'), raw.sync()]))
      await sleep(50)
      await sendCancel(server, raw)
      await raw.readUntil('Z')
      raw.socket.destroy()

      await holder.query('COMMIT')
      await vi.waitFor(async () => expect(await prepared(raw.processId)).toEqual([]))
    })

    it('closes a statement whose Close was discarded with the client', async () => {
      const holder = await connectClient(server)
      const raw = await connectRaw(server)

      raw.socket.write(Buffer.concat([raw.parse('discarded', 'SELECT 1'), raw.sync()]))
      await raw.readUntil('Z')
      await holder.query('BEGIN')

      raw.socket.write(Buffer.concat([closeStatement('discarded'), raw.sync()]))
      await sleep(50)
      raw.socket.destroy()
      await sleep(50)

      await holder.query('COMMIT')
      await vi.waitFor(async () => expect(await prepared(raw.processId)).toEqual([]))
    })

    it('keeps a statement whose DEALLOCATE failed', async () => {
      const raw = await connectRaw(server)

      raw.socket.write(raw.query('PREPARE kept AS SELECT 1'))
      await raw.readUntil('Z')
      raw.socket.write(
        Buffer.concat([raw.query('BEGIN'), raw.query('SELECT 1/0'), raw.query('DEALLOCATE kept')]),
      )
      await raw.readUntil('Z')
      await raw.readUntil('Z')
      expect(messageTypes(await raw.readUntil('Z'))).toBe('EZ')
      raw.socket.end(frontendMessage('X'))
      await once(raw.socket, 'close')

      await vi.waitFor(async () => expect(await prepared(raw.processId)).toEqual([]))
    })

    it('deallocates its statements, not a failed one, on DEALLOCATE ALL', async () => {
      const raw = await connectRaw(server)

      raw.socket.write(
        Buffer.concat([
          raw.parse('broken', 'SELEC 1'),
          raw.sync(),
          raw.parse('good', 'SELECT 1'),
          raw.sync(),
          raw.query('DEALLOCATE ALL'),
        ]),
      )
      expect(messageTypes(await raw.readUntil('Z'))).toBe('EZ')
      expect(messageTypes(await raw.readUntil('Z'))).toBe('1Z')
      expect(messageTypes(await raw.readUntil('Z'))).toBe('CZ')
      expect(await prepared(raw.processId)).toEqual([])
    })

    it('runs the statements after DEALLOCATE ALL in the same query', async () => {
      const raw = await connectRaw(server)

      raw.socket.write(raw.query('PREPARE gone AS SELECT 1'))
      await raw.readUntil('Z')
      raw.socket.write(raw.query('DEALLOCATE ALL; SELECT 2 AS v'))

      const messages = await raw.readUntil('Z')

      expect(messageTypes(messages)).toBe('CTDCZ')
      expect(messages[2]?.body.subarray(6).toString()).toBe('2')
      expect(await prepared(raw.processId)).toEqual([])
    })

    it("leaves the other clients' statements alone on DEALLOCATE ALL", async () => {
      const owner = await connectClient(server)
      const other = await connectClient(server)

      await owner.query('PREPARE owned AS SELECT 1 AS v')
      await other.query('DEALLOCATE ALL')
      expect((await owner.query('EXECUTE owned')).rows).toEqual([{ v: 1 }])
    })
  })

  it('holds other clients back while a client is in a transaction', async () => {
    const client1 = await connectClient(server)
    const client2 = await connectClient(server)

    await client1.query('CREATE TABLE hold_test (id SERIAL PRIMARY KEY)')
    await client1.query('BEGIN')
    await client1.query('INSERT INTO hold_test DEFAULT VALUES')

    let countResolved = false
    const count = client2
      .query<{ count: string }>('SELECT count(*) FROM hold_test')
      .then(({ rows }) => {
        countResolved = true

        return rows[0]?.count
      })

    await sleep(50)
    expect(countResolved).toBe(false)

    await client1.query('ROLLBACK')

    expect(await count).toBe('0')
  })

  it('rolls back the open transaction of a client that disconnects', async () => {
    const client1 = await connectClient(server)
    const client2 = await connectClient(server)

    await client1.query('CREATE TABLE disconnect_test (id SERIAL PRIMARY KEY)')
    await client1.query('BEGIN')
    await client1.query('INSERT INTO disconnect_test DEFAULT VALUES')

    const count = client2.query<{ count: string }>('SELECT count(*) FROM disconnect_test')

    // Drop the socket without a Terminate message.
    client1.on('error', () => {})
    client1.connection.stream.destroy()

    expect((await count).rows).toEqual([{ count: '0' }])
  })

  it('terminates a connection that breaks the framing with a protocol violation', async () => {
    const raw = await connectRaw(server)

    // A length shorter than the length field itself.
    raw.socket.write(Buffer.from([0x51, 0, 0, 0, 3]))

    const [error] = await raw.readUntil('E')

    expect(error?.body.toString()).toContain('C08P01\0')
    await once(raw.socket, 'close')
  })

  describe('cancel requests', () => {
    const canceled = { code: '57014', message: 'canceling statement due to user request' }

    const expectCanceled = (error: { type: string; body: Buffer } | undefined) => {
      const fields = error?.body.toString() ?? ''

      expect(error?.type).toBe('E')
      expect(fields).toContain('SERROR\0')
      expect(fields).toContain(`C${canceled.code}\0`)
      expect(fields).toContain(`M${canceled.message}\0`)
    }

    it("cancels a query waiting for another client's transaction", async () => {
      const holder = await connectClient(server)
      const { client: waiter, key } = await connectKeyed(server)

      await holder.query('CREATE TABLE cancel_waiting (id int)')
      await holder.query('BEGIN')
      await holder.query('INSERT INTO cancel_waiting VALUES (1)')

      const waiting = waiter.query('INSERT INTO cancel_waiting VALUES (2)').catch((error) => error)

      await sleep(50)
      await sendCancel(server, key)

      // Answered while the holder is still inside its transaction.
      await expect(within(waiting)).resolves.toMatchObject(canceled)

      await holder.query('COMMIT')
      expect((await waiter.query('SELECT id FROM cancel_waiting')).rows).toEqual([{ id: 1 }])
    })

    it('cancels a query waiting for the app to release PGlite', async () => {
      const { client: waiter, key } = await connectKeyed(server)

      let end!: () => void
      const held = new Promise<void>((resolve) => {
        end = resolve
      })
      const transaction = db.transaction(() => held)

      try {
        const waiting = waiter.query('SELECT 1').catch((error) => error)

        await sleep(50)
        await sendCancel(server, key)

        await expect(within(waiting)).resolves.toMatchObject(canceled)
      } finally {
        end()
        await transaction
      }

      expect((await waiter.query('SELECT 2 AS v')).rows).toEqual([{ v: 2 }])
    })

    it('ignores a cancel for a client with nothing to cancel', async () => {
      const raw = await connectRaw(server)

      await sendCancel(server, raw)

      raw.socket.write(raw.query('SELECT 1 AS v'))
      expect(messageTypes(await raw.readUntil('Z'))).toBe('TDCZ')
    })

    it('ignores a cancel with the wrong secret key or process id', async () => {
      const holder = await connectClient(server)
      const { client: waiter, key } = await connectKeyed(server)

      await holder.query('BEGIN')

      const waiting = waiter.query('SELECT 1 AS v')

      await sleep(50)
      await sendCancel(server, { ...key, secretKey: key.secretKey ^ 1 })
      await sendCancel(server, { ...key, processId: key.processId + 1000 })
      expect(await within(waiting, 100)).toBe('pending')

      await holder.query('COMMIT')
      expect((await waiting).rows).toEqual([{ v: 1 }])
    })

    // PGlite cannot interrupt a statement, and Postgres ignores a cancel that
    // arrives while the backend is idle in a transaction.
    it('ignores a cancel for the client owning the backend', async () => {
      const { client: owner, key } = await connectKeyed(server)

      await owner.query('CREATE TABLE cancel_owner (id int)')
      await owner.query('BEGIN')
      await owner.query('INSERT INTO cancel_owner VALUES (1)')
      await sendCancel(server, key)

      const running = owner.query<{ v: string }>('SELECT pg_sleep(0.1)::text AS v')

      await sleep(10)
      await sendCancel(server, key)

      expect((await running).rows).toEqual([{ v: '' }])
      await owner.query('COMMIT')
      expect((await owner.query('SELECT id FROM cancel_owner')).rows).toEqual([{ id: 1 }])
    })

    it('cancels the whole waiting query string and runs the queries after it', async () => {
      const holder = await connectClient(server)
      const raw = await connectRaw(server)

      await holder.query('CREATE TABLE cancel_batch (id int)')
      await holder.query('BEGIN')

      raw.socket.write(
        Buffer.concat([
          raw.query('INSERT INTO cancel_batch VALUES (1); INSERT INTO cancel_batch VALUES (2)'),
          raw.query('SELECT 3 AS v'),
        ]),
      )
      await sleep(50)
      await sendCancel(server, raw)

      const [error, ready] = await raw.readUntil('Z')

      expectCanceled(error)
      expect(ready?.body.toString()).toBe('I')

      await holder.query('COMMIT')

      const next = await raw.readUntil('Z')

      expect(messageTypes(next)).toBe('TDCZ')
      expect(next[1]?.body.subarray(6).toString()).toBe('3')
      expect((await holder.query('SELECT count(*)::int AS n FROM cancel_batch')).rows).toEqual([
        { n: 0 },
      ])
    })

    it('cancels a waiting pipeline up to its Sync', async () => {
      const holder = await connectClient(server)
      const raw = await connectRaw(server)

      await holder.query('BEGIN')

      raw.socket.write(
        Buffer.concat([raw.parse('', 'SELECT 1'), raw.bind(''), raw.execute(), raw.sync()]),
      )
      await sleep(50)
      await sendCancel(server, raw)

      const synced = await raw.readUntil('Z')

      expect(messageTypes(synced)).toBe('EZ')
      expectCanceled(synced[0])

      // Cancelled before its Sync arrived: the rest is skipped until the Sync.
      raw.socket.write(Buffer.concat([raw.parse('', 'SELECT 1'), raw.bind('')]))
      await sleep(50)
      await sendCancel(server, raw)
      expectCanceled((await raw.readUntil('E'))[0])

      raw.socket.write(Buffer.concat([raw.execute(), raw.sync()]))
      expect(messageTypes(await raw.readUntil('Z'))).toBe('Z')

      await holder.query('COMMIT')
      raw.socket.write(raw.query('SELECT 1 AS v'))
      expect(messageTypes(await raw.readUntil('Z'))).toBe('TDCZ')
    })
  })

  describe('session state', () => {
    it('resets settings, temp tables and advisory locks when a client disconnects', async () => {
      const first = await connectClient(server)
      await first.query("SET application_name = 'first'")
      await first.query('CREATE TEMP TABLE scratch (id int)')
      expect((await first.query('SELECT pg_try_advisory_lock(42) AS ok')).rows[0]?.ok).toBe(true)
      await first.end()

      const second = await connectClient(server)
      expect((await second.query('SHOW application_name')).rows[0]?.application_name).not.toBe(
        'first',
      )
      expect((await second.query("SELECT to_regclass('scratch') AS t")).rows[0]?.t).toBeNull()
      expect((await second.query('SELECT pg_try_advisory_lock(42) AS ok')).rows[0]?.ok).toBe(true)
    })

    it("keeps a client's advisory locks while another client disconnects", async () => {
      const holder = await connectClient(server)
      expect((await holder.query('SELECT pg_try_advisory_lock(7) AS ok')).rows[0]?.ok).toBe(true)

      await visitAndLeave(server)

      expect((await holder.query('SELECT pg_advisory_unlock(7) AS ok')).rows[0]?.ok).toBe(true)
    })

    it("keeps a client's temp tables while another client disconnects", async () => {
      const holder = await connectClient(server)
      await holder.query('CREATE TEMP TABLE kept (id int)')
      await holder.query('INSERT INTO kept VALUES (1)')

      await visitAndLeave(server)

      expect((await holder.query('SELECT id FROM kept')).rows).toEqual([{ id: 1 }])
    })

    it("keeps a client's settings while another client disconnects", async () => {
      const holder = await connectClient(server)
      await holder.query("SET application_name = 'holder'")

      await visitAndLeave(server)

      expect((await holder.query('SHOW application_name')).rows[0]?.application_name).toBe('holder')
    })

    it('resets the session state once the last client disconnects', async () => {
      const holder = await connectClient(server)
      const { application_name: initial } = (await holder.query('SHOW application_name')).rows[0]
      await holder.query("SET application_name = 'holder'")
      await holder.query('CREATE TEMP TABLE scratch_last (id int)')
      expect((await holder.query('SELECT pg_try_advisory_lock(7) AS ok')).rows[0]?.ok).toBe(true)

      await visitAndLeave(server)
      await holder.end()

      const next = await connectClient(server)
      expect((await next.query('SHOW application_name')).rows[0]?.application_name).toBe(initial)
      expect((await next.query("SELECT to_regclass('scratch_last') AS t")).rows[0]?.t).toBeNull()
      expect((await next.query('SELECT pg_try_advisory_lock(7) AS ok')).rows[0]?.ok).toBe(true)
      expect((await next.query('SELECT pg_advisory_unlock(7) AS ok')).rows[0]?.ok).toBe(true)
    })

    it('resets the session state after what the clients queued before leaving', async () => {
      const owner = await connectClient(server)
      await owner.query('BEGIN')

      // Queued behind the owner's transaction, still run after its Terminate.
      const leaver = await connectRaw(server)
      leaver.socket.end(
        Buffer.concat([
          frontendMessage('Q', text('CREATE TEMP TABLE queued_last (id int)')),
          frontendMessage('X'),
        ]),
      )
      await once(leaver.socket, 'close')

      // The last client to leave, while the queued table is still to come.
      owner.on('error', () => {})
      owner.connection.stream.destroy()
      await vi.waitFor(() => expect(server.connections).toBe(0))

      const next = await connectClient(server)
      expect((await next.query("SELECT to_regclass('queued_last') AS t")).rows[0]?.t).toBeNull()
    })
  })

  describe('LISTEN/NOTIFY', () => {
    it('delivers notifications across connections', async () => {
      const listener = await connectClient(server)
      const notifier = await connectClient(server)
      const received = collect(listener)

      await listener.query('LISTEN across_channel')
      await notifier.query("NOTIFY across_channel, 'hello'")
      await notifier.query("NOTIFY across_channel, 'world'")

      await vi.waitFor(() =>
        expect(received).toEqual([
          { channel: 'across_channel', payload: 'hello' },
          { channel: 'across_channel', payload: 'world' },
        ]),
      )
    })

    it('delivers only to the clients that LISTEN on the channel', async () => {
      const listener = await connectClient(server)
      const bystander = await connectClient(server)
      const notifier = await connectClient(server)
      const heard = collect(listener)
      const overheard = collect(bystander)

      await listener.query('LISTEN scoped_channel')
      await bystander.query('LISTEN other_channel')
      await notifier.query("NOTIFY scoped_channel, 'private'")
      await notifier.query("NOTIFY other_channel, 'theirs'")

      await vi.waitFor(() =>
        expect(overheard).toEqual([{ channel: 'other_channel', payload: 'theirs' }]),
      )
      expect(heard).toEqual([{ channel: 'scoped_channel', payload: 'private' }])
    })

    it('keeps delivering to a listener when another client UNLISTENs the channel', async () => {
      const keeper = await connectClient(server)
      const leaver = await connectClient(server)
      const notifier = await connectClient(server)
      const received = collect(keeper)

      await keeper.query('LISTEN kept_channel')
      await leaver.query('LISTEN kept_channel')
      await leaver.query('UNLISTEN kept_channel')
      await notifier.query("NOTIFY kept_channel, 'still here'")

      await vi.waitFor(() =>
        expect(received).toEqual([{ channel: 'kept_channel', payload: 'still here' }]),
      )
    })

    it('keeps delivering to a listener after another client disconnects', async () => {
      const keeper = await connectClient(server)
      const leaver = await connectClient(server)
      const notifier = await connectClient(server)
      const received = collect(keeper)

      await keeper.query('LISTEN survivor_channel')
      await leaver.query('LISTEN survivor_channel')
      await leaver.end()
      await notifier.query("NOTIFY survivor_channel, 'after leave'")

      await vi.waitFor(() =>
        expect(received).toEqual([{ channel: 'survivor_channel', payload: 'after leave' }]),
      )
    })

    it('stops delivering after UNLISTEN', async () => {
      const listener = await connectClient(server)
      const notifier = await connectClient(server)
      const received = collect(listener)

      await listener.query('LISTEN unlisten_channel')
      await notifier.query("NOTIFY unlisten_channel, 'before'")
      await vi.waitFor(() => expect(received).toHaveLength(1))

      await listener.query('UNLISTEN unlisten_channel')
      await notifier.query("NOTIFY unlisten_channel, 'after'")
      await sleep(50)

      expect(received.map(({ payload }) => payload)).toEqual(['before'])
    })

    it('delivers a notification to every listener, also after one disconnects', async () => {
      const listener1 = await connectClient(server)
      const listener2 = await connectClient(server)
      const notifier = await connectClient(server)
      const received1 = collect(listener1)
      const received2 = collect(listener2)

      await listener1.query('LISTEN shared_channel')
      await listener2.query('LISTEN shared_channel')
      await notifier.query("NOTIFY shared_channel, 'broadcast'")

      await vi.waitFor(() => {
        expect(received1.map(({ payload }) => payload)).toEqual(['broadcast'])
        expect(received2.map(({ payload }) => payload)).toEqual(['broadcast'])
      })

      await listener1.end()
      await notifier.query("NOTIFY shared_channel, 'after_close'")

      await vi.waitFor(() =>
        expect(received2.map(({ payload }) => payload)).toEqual(['broadcast', 'after_close']),
      )
    })

    it('handles quoted channel names', async () => {
      const listener = await connectClient(server)
      const notifier = await connectClient(server)
      const received = collect(listener)

      await listener.query('LISTEN "MyChannel"')
      await notifier.query(`NOTIFY "MyChannel", 'test'`)

      await vi.waitFor(() => expect(received).toEqual([{ channel: 'MyChannel', payload: 'test' }]))
    })

    it('delivers a notification once to a client that notifies its own channel', async () => {
      const client = await connectClient(server)
      const received = collect(client)

      await client.query('LISTEN self_channel')
      await client.query("NOTIFY self_channel, 'echo'")
      await vi.waitFor(() => expect(received).toHaveLength(1))
      await sleep(50)

      expect(received.map(({ payload }) => payload)).toEqual(['echo'])
    })
  })
})

describe('createPGliteSocketServer lifecycle and options', () => {
  let db: PGlite
  const servers: PGliteSocketServer[] = []

  const createServer = (options?: Parameters<typeof createPGliteSocketServer>[1]) => {
    const server = createPGliteSocketServer(db, options)

    servers.push(server)

    return server
  }

  beforeAll(() => {
    db = new PGlite()
  })

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()))
    servers.length = 0
  })

  afterAll(async () => {
    await db.close()
  })

  it('does nothing until listen() and tolerates closing twice', async () => {
    const server = createServer()

    expect(server.address).toBeUndefined()
    expect(server.connections).toBe(0)
    expect(() => server.url).toThrow(/not listening/)

    await expect(server.listen()).resolves.toBe(server)

    const { url } = server

    await connectClient(server)
    expect(server.connections).toBe(1)

    await server.close()
    await server.close()

    expect(server.address).toBeUndefined()
    expect(server.connections).toBe(0)
    await expect(createClient(url).connect()).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('starts over when listen() follows close() right away', async () => {
    const server = await createServer().listen()
    const closed = server.close()
    const listening = server.listen()

    await Promise.all([closed, listening])
    expect(server.address).toBeDefined()
    expect((await (await connectClient(server)).query('SELECT 1 AS v')).rows).toEqual([{ v: 1 }])

    // And a close after that one tears the new start down too.
    const closedAgain = server.close()
    const relisten = server.listen()
    const last = server.close()

    await Promise.all([closedAgain, relisten, last])
    expect(server.address).toBeUndefined()
  })

  it('listens on the given host and port', async () => {
    const probe = await createServer().listen()
    const { port } = tcpAddress(probe)

    await probe.close()

    const server = await createServer({
      host: 'localhost',
      port,
      user: 'me',
      database: 'app',
    }).listen()
    const address = tcpAddress(server)
    const host = address.host.includes(':') ? `[${address.host}]` : address.host

    expect(address.port).toBe(port)
    expect(['127.0.0.1', '::1']).toContain(address.host)
    expect(server.url).toBe(`postgres://me@${host}:${String(port)}/app`)
  })

  it('rolls back the open transaction of a client on close and leaves PGlite open', async () => {
    const server = await createServer().listen()
    const client = await connectClient(server)

    client.on('error', () => {})

    await client.query('CREATE TABLE close_test (id SERIAL PRIMARY KEY)')
    await client.query('BEGIN')
    await client.query('INSERT INTO close_test DEFAULT VALUES')

    await server.close()

    expect(db.isInTransaction()).toBe(false)
    expect((await db.query('SELECT count(*)::int AS count FROM close_test')).rows).toEqual([
      { count: 0 },
    ])
  })

  // PGlite's `close()` takes the locks the backend holds for a client: one
  // left held would keep the instance from ever closing.
  it('leaves the locks free once closed while a client waits on the app', async () => {
    const own = new PGlite()
    const server = await createPGliteSocketServer(own).listen()
    const client = await connectClient(server)

    client.on('error', () => {})

    let end!: () => void
    const held = new Promise<void>((resolve) => {
      end = resolve
    })
    const transaction = own.transaction(() => held)
    const waiting = client.query('SELECT 1').catch((error: unknown) => error)

    // The client's query is now waiting on the app's transaction.
    await sleep(50)
    const closed = server.close()
    end()

    await Promise.all([transaction, closed])
    await expect(waiting).resolves.toBeInstanceOf(Error)
    await own.close()
    expect(own.closed).toBe(true)
  })

  it('cleans up after a client that left with a query queued, once closed', async () => {
    const own = new PGlite()
    const server = await createPGliteSocketServer(own).listen()
    const holder = await connectClient(server)

    holder.on('error', () => {})
    await holder.query("SET application_name = 'held'")
    await holder.query('BEGIN')

    // Queued behind the holder's transaction, then left: `query()` and
    // `end()` in a row.
    const leaver = await connectRaw(server)

    leaver.socket.write(
      Buffer.concat([leaver.query('CREATE TABLE never_run (id int)'), frontendMessage('X')]),
    )
    await sleep(50)
    await server.close()

    const state = own.query<{ t: string | null; name: string }>(
      "SELECT to_regclass('never_run')::text AS t, current_setting('application_name') AS name",
    )

    expect(await within(state.then(({ rows }) => rows))).toEqual([
      { t: null, name: expect.not.stringMatching(/^held$/) },
    ])
    expect(await within(own.close().then(() => 'closed'))).toBe('closed')
  })

  it("keeps the app's statement out of a transaction rolled back on close", async () => {
    const own = new PGlite()
    const server = await createPGliteSocketServer(own).listen()
    const client = await connectClient(server)

    client.on('error', () => {})
    await client.query('CREATE TABLE close_app (id int)')
    await client.query('BEGIN')
    await client.query('INSERT INTO close_app VALUES (1)')

    const seen = own.query<{ n: number }>('SELECT count(*)::int AS n FROM close_app')

    // The cleanup on close starts with a Sync: it is held back until the
    // app's statement has run, or long enough for it to have run were the
    // locks free.
    const execProtocolRaw = own.execProtocolRaw.bind(own)
    let closing = false

    vi.spyOn(own, 'execProtocolRaw').mockImplementation(async (message, options) => {
      if (closing && message[0] === 0x53) {
        await Promise.race([seen, sleep(200)])
      }

      return execProtocolRaw(message, options)
    })

    await sleep(50)
    closing = true
    await server.close()

    expect((await seen).rows).toEqual([{ n: 0 }])
    await own.close()
  })

  it('frees the backend when forwarding a message fails', async () => {
    const own = new PGlite()
    const server = await createPGliteSocketServer(own).listen()
    const client = await connectClient(server)

    client.on('error', () => {})
    vi.spyOn(own, 'execProtocolRaw').mockRejectedValueOnce(new Error('backend failure'))

    await expect(client.query('SELECT 1')).rejects.toMatchObject({ code: '57P01' })
    expect(await within(own.query('SELECT 1 AS v').then(({ rows }) => rows))).toEqual([{ v: 1 }])

    await server.close()
    await own.close()
  })

  it('refuses clients beyond maxConnections', async () => {
    const server = await createServer({ maxConnections: 1 }).listen()
    const first = await connectClient(server)

    await expect(createClient(server.url).connect()).rejects.toMatchObject({ code: '53300' })

    await first.end()
    await vi.waitFor(() => expect(server.connections).toBe(0))

    const next = await connectClient(server)

    expect((await next.query('SELECT 1 AS v')).rows).toEqual([{ v: 1 }])
  })

  it('terminates a client left idle in a transaction', async () => {
    const server = await createServer({ idleInTransactionTimeout: 100 }).listen()
    const idle = await connectClient(server)
    const waiting = await connectClient(server)
    const terminated = firstError(idle)

    await idle.query('CREATE TABLE idle_test (id SERIAL PRIMARY KEY)')
    await idle.query('BEGIN')
    await idle.query('INSERT INTO idle_test DEFAULT VALUES')

    const count = waiting.query<{ count: number }>('SELECT count(*)::int AS count FROM idle_test')

    await expect(terminated).resolves.toMatchObject({ code: '25P03' })
    expect((await count).rows).toEqual([{ count: 0 }])

    // Idle outside of a transaction is not affected.
    await sleep(150)
    expect((await waiting.query('SELECT 1 AS v')).rows).toEqual([{ v: 1 }])
  })

  describe.skipIf(process.platform === 'win32')('on a Unix socket', () => {
    let directory: string

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), 'pglite-socket-'))
    })

    afterAll(async () => {
      await rm(directory, { force: true, recursive: true })
    })

    it('replaces a stale socket file, serves clients and removes the file on close', async () => {
      // Clients look for `<host>/.s.PGSQL.<port>` when `host` is a directory.
      const path = join(directory, '.s.PGSQL.5432')
      const server = createServer({ path: directory })

      // A server killed while listening leaves its socket file behind.
      spawnSync(process.execPath, [
        '-e',
        `require('node:net').createServer().listen(process.argv[1], () => process.kill(process.pid, 'SIGKILL'))`,
        path,
      ])
      expect(lstatSync(path).isSocket()).toBe(true)

      await server.listen()

      expect(server.address).toEqual({ path: directory, port: 5432 })
      expect(server.url).toBe(
        `postgres://postgres@localhost:5432/postgres?host=${encodeURIComponent(directory)}`,
      )

      // The URL form a client receives: `host` is the directory.
      const client = createClient({ connectionString: server.url })

      await client.connect()
      expect((await client.query('SELECT 1 AS v')).rows).toEqual([{ v: 1 }])

      await expect(createServer({ path: directory }).listen()).rejects.toMatchObject({
        code: 'EADDRINUSE',
      })

      await server.close()
      expect(existsSync(path)).toBe(false)
    })
  })
})
