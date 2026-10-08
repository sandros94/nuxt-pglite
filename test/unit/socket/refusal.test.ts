import { once } from 'node:events'
import { connect as connectSocket } from 'node:net'

import { PGlite } from '@electric-sql/pglite'
import { Client } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'

import { createPGliteSocketServer } from '../../../src/runtime/socket'
import type { PGliteSocketServer } from '../../../src/runtime/socket'

const servers: PGliteSocketServer[] = []
const instances: PGlite[] = []

const listen = async (
  db: PGlite | null,
  options?: Parameters<typeof createPGliteSocketServer>[1],
) => {
  const server = createPGliteSocketServer(db, options)
  servers.push(server)
  return server.listen()
}

const open = () => {
  const db = new PGlite()
  instances.push(db)
  return db
}

const connect = async (server: PGliteSocketServer) => {
  const client = new Client(server.url)
  client.on('error', () => {})
  await client.connect()
  return client
}

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()))
  await Promise.all(instances.map((db) => db.close()))
  servers.length = 0
  instances.length = 0
})

describe('a refusing socket server', () => {
  it('answers new clients with a FATAL 57P03 carrying the reason and hint', async () => {
    const server = await listen(null)
    await server.refuse(new Error('relation "users" already exists'), { hint: 'Reset it.' })

    await expect(connect(server)).rejects.toMatchObject({
      severity: 'FATAL',
      code: '57P03',
      message: 'PGlite is not ready: relation "users" already exists',
      hint: 'Reset it.',
    })
  })

  it('refuses without an instance until one is served', async () => {
    const server = await listen(null)

    await expect(connect(server)).rejects.toMatchObject({ code: '57P03' })

    await server.serve(open())
    const client = await connect(server)
    expect((await client.query('SELECT 1 AS v')).rows).toEqual([{ v: 1 }])
    await client.end()
  })

  it('disconnects the clients of a refused instance, then serves a new one at the same URL', async () => {
    const first = open()
    const server = await listen(first)
    const { url } = server
    const client = await connect(server)
    await client.query('CREATE TABLE swap_test (id int)')
    const ended = new Promise((resolve) => client.once('end', resolve))

    await server.refuse(new Error('the database is being reset'))
    await ended
    await expect(connect(server)).rejects.toMatchObject({
      code: '57P03',
      message: 'PGlite is not ready: the database is being reset',
    })
    // Left open for its owner.
    expect(first.closed).toBe(false)

    await server.serve(open())
    expect(server.url).toBe(url)
    const next = await connect(server)
    await expect(next.query('SELECT * FROM swap_test')).rejects.toMatchObject({ code: '42P01' })
    expect((await next.query('SELECT 2 AS v')).rows).toEqual([{ v: 2 }])
    await next.end()
  })

  it('admits a client when its startup message arrives, not when it was accepted', async () => {
    const server = await listen(null)
    const address = server.address
    if (!address || !('host' in address)) {
      throw new Error('Expected a TCP address')
    }
    const socket = connectSocket(address.port, address.host)
    try {
      await once(socket, 'connect')
      await server.serve(open())

      const startup = Buffer.concat([Buffer.alloc(8), Buffer.from('user\0postgres\0\0')])
      startup.writeInt32BE(startup.length, 0)
      startup.writeInt32BE(196608, 4)
      socket.write(startup)

      const reply = await new Promise<Buffer>((resolve) => socket.once('data', resolve))
      // AuthenticationOk rather than an ErrorResponse (`E`).
      expect(String.fromCharCode(reply[0]!)).toBe('R')
    } finally {
      socket.destroy()
    }
  })

  it('frees the room of the clients a refusal disconnects', async () => {
    const db = open()
    const server = await listen(db, { maxConnections: 1 })
    await connect(server)

    await server.refuse(new Error('switching'))
    await server.serve(db)

    const client = await connect(server)
    expect((await client.query('SELECT 1 AS v')).rows).toEqual([{ v: 1 }])
    await client.end()
  })

  it('keeps its state across a restart', async () => {
    const server = await listen(null)
    await server.refuse(new Error('broken'))
    await server.close()
    await server.listen()

    await expect(connect(server)).rejects.toMatchObject({ message: 'PGlite is not ready: broken' })
  })
})
