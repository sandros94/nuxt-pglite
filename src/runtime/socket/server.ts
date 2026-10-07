import { lstat, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connect, createServer, type Server } from 'node:net'

import type { PGlite } from '@electric-sql/pglite'

import { Backend } from './backend'
import {
  readServerParameters,
  readSessionSettings,
  serveConnection,
  type Connection,
  type Termination,
} from './connection'
import { routeNotifications } from './notifications'

export interface PGliteSocketServerOptions {
  /**
   * Interface to listen on.
   * @default '127.0.0.1'
   */
  host?: string

  /**
   * Port to listen on. 0 picks a random free port.
   * @default 0
   */
  port?: number

  /**
   * Directory to serve a Unix socket from instead of `host`. The socket file
   * is named `.s.PGSQL.<port>` (5432 unless `port` is set), which is where
   * Postgres clients look when given a directory as host. A stale socket file
   * left behind by a server that did not shut down cleanly is removed first.
   */
  path?: string

  /**
   * Clients beyond this many concurrent connections are refused with SQLSTATE
   * 53300 (`too_many_connections`).
   * @default Infinity
   */
  maxConnections?: number

  /**
   * Milliseconds a client may hold the backend idle inside a transaction
   * before its connection is terminated with SQLSTATE 25P03
   * (`idle_in_transaction_session_timeout`), which rolls the transaction back
   * and frees the backend for the waiting clients. 0 disables the timeout.
   * @default 0
   */
  idleInTransactionTimeout?: number

  /**
   * User name put in `url`. Clients are not authenticated.
   * @default 'postgres'
   */
  user?: string

  /**
   * Database name put in `url`. Every name reaches the same database.
   * @default 'postgres'
   */
  database?: string

  /**
   * Receives unexpected connection errors (a client resetting its connection
   * is expected).
   */
  logger?: (...message: unknown[]) => void
}

export interface PGliteSocketServer {
  /**
   * Connection string for the clients. Throws until `listen()` has resolved.
   */
  readonly url: string

  /**
   * Address the server listens on, undefined while not listening.
   */
  readonly address: { host: string; port: number } | { path: string; port: number } | undefined

  /**
   * Number of open client sockets.
   */
  readonly connections: number

  listen(): Promise<PGliteSocketServer>

  /**
   * Destroys the client sockets, rolling back their open transactions, stops
   * listening and waits for the message being executed. The PGlite instance
   * is left open: it belongs to the caller.
   */
  close(): Promise<void>
}

// What Postgres reports once `max_connections` is reached.
const TOO_MANY_CLIENTS: Termination = { code: '53300', message: 'sorry, too many clients already' }

// Wildcard addresses accept connections but are not a destination on every
// platform, so the URL points at the loopback interface instead.
const CONNECTABLE_HOSTS: Record<string, string> = { '0.0.0.0': '127.0.0.1', '::': '::1' }

interface Listening {
  server: Server
  backend: Backend
  address: { host: string; port: number } | { path: string; port: number }
  unsubscribe: () => void
}

/**
 * Creates a Postgres wire-protocol server in front of `db`. The server neither
 * opens nor closes `db`.
 */
export function createPGliteSocketServer(
  db: PGlite,
  options: PGliteSocketServerOptions = {},
): PGliteSocketServer {
  const {
    database = 'postgres',
    host = '127.0.0.1',
    idleInTransactionTimeout = 0,
    logger = () => {},
    maxConnections = Infinity,
    path,
    port = 0,
    user = 'postgres',
  } = options

  const connections = new Set<Connection>()
  let admitted = 0
  let nextProcessId = 1

  let current: Listening | undefined
  let listening: Promise<PGliteSocketServer> | undefined
  let closing: Promise<void> | undefined

  const onError = (error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ECONNRESET') {
      return
    }

    logger('Unexpected connection error:', error)
  }

  const start = async (): Promise<PGliteSocketServer> => {
    const [serverParameters, sessionSettings] = await Promise.all([
      readServerParameters(db),
      readSessionSettings(db),
    ])
    const backend = new Backend(db, { idleInTransactionTimeout, sessionSettings })

    const server = createServer((socket) => {
      const refused = admitted >= maxConnections

      if (!refused) {
        admitted++
      }

      const connection = serveConnection(socket, {
        backend,
        onError,
        processId: nextProcessId++,
        refusal: refused ? TOO_MANY_CLIENTS : undefined,
        serverParameters,
      })

      connections.add(connection)

      socket.once('close', () => {
        connections.delete(connection)

        if (!refused) {
          admitted--
        }
      })
    })

    // Postgres clients given a directory as host connect to this file in it.
    const socketPort = port || 5432
    let socketFile: string | undefined

    if (path !== undefined) {
      socketFile = join(path, `.s.PGSQL.${String(socketPort)}`)
      await mkdir(path, { recursive: true })
      await removeStaleSocket(socketFile)
    }

    await new Promise<void>((resolve, reject) => {
      const onListening = () => {
        server.off('error', reject)
        resolve()
      }

      server.once('error', reject)

      if (socketFile === undefined) {
        server.listen(port, host, onListening)
      } else {
        server.listen(socketFile, onListening)
      }
    })

    server.on('error', (error) => logger('Unexpected server error:', error))

    // A string for a Unix socket or named pipe.
    const address = server.address()

    if (address === null) {
      throw new Error('The PGlite socket server stopped listening while starting.')
    }

    current = {
      server,
      backend,
      address:
        typeof address === 'string'
          ? { path: path ?? address, port: socketPort }
          : { host: address.address, port: address.port },
      unsubscribe: routeNotifications(db, backend),
    }

    return socketServer
  }

  const stop = async () => {
    await listening?.catch(() => {})

    const stopping = current

    current = undefined
    listening = undefined

    if (!stopping) {
      return
    }

    const { backend, server, unsubscribe } = stopping
    const serverClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })

    unsubscribe()

    // Long-lived clients (pools, LISTEN) would otherwise keep the server open.
    const socketsClosed = Array.from(connections, (connection) => connection.destroy())

    await Promise.all([serverClosed, backend.close(), ...socketsClosed])
  }

  const socketServer: PGliteSocketServer = {
    get url() {
      if (!current) {
        throw new Error('The PGlite socket server is not listening: await listen() first.')
      }

      const auth = encodeURIComponent(user)
      const name = encodeURIComponent(database)
      const { address } = current

      if ('path' in address) {
        return `postgres://${auth}@localhost:${String(address.port)}/${name}?host=${encodeURIComponent(address.path)}`
      }

      const target = CONNECTABLE_HOSTS[address.host] ?? address.host
      const hostname = target.includes(':') ? `[${target}]` : target

      return `postgres://${auth}@${hostname}:${String(address.port)}/${name}`
    },

    get address() {
      return current?.address
    },

    get connections() {
      return connections.size
    },

    listen() {
      // A close in progress finishes first: starting over its teardown would
      // hand out a server about to stop.
      listening ??= (closing ?? Promise.resolve()).then(start).catch((error: unknown) => {
        listening = undefined

        throw error
      })

      return listening
    },

    close() {
      closing ??= stop().finally(() => {
        closing = undefined
      })

      return closing
    },
  }

  return socketServer
}

// A socket file left behind by a server that did not shut down cleanly makes
// `listen` fail with EADDRINUSE. It is removed only when nothing accepts
// connections on it, so a running server is never displaced.
async function removeStaleSocket(path: string): Promise<void> {
  const stats = await lstat(path).catch(() => undefined)

  if (!stats?.isSocket()) {
    return
  }

  const stale = await new Promise<boolean>((resolve) => {
    const probe = connect(path)

    probe.once('connect', () => {
      probe.destroy()
      resolve(false)
    })
    probe.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'ECONNREFUSED')
    })
  })

  if (stale) {
    await rm(path, { force: true })
  }
}
