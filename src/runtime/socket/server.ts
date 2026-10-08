import { lstat, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connect, createServer, type Server, type Socket } from 'node:net'

import type { PGlite } from '@electric-sql/pglite'

import { Backend } from './backend'
import {
  readServerParameters,
  readSessionSettings,
  serveConnection,
  type Connection,
  type ConnectionOptions,
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
   * Serves `db` from now on, ending a refusal: the URL stays the same, so a
   * recreated instance takes the place of the previous one. The clients of
   * the previous instance are disconnected, rolling back their transactions;
   * that instance is left open, as it belongs to the caller.
   */
  serve(db: PGlite): Promise<void>

  /**
   * Stops serving the instance and refuses every new client until `serve()`:
   * its handshake ends with a FATAL ErrorResponse, SQLSTATE 57P03
   * (`cannot_connect_now`), the message `PGlite is not ready: <reason>` and
   * `hint` when given. Connected clients are disconnected, rolling back their
   * transactions; the instance is left open, for the caller to close.
   */
  refuse(reason: Error, options?: { hint?: string }): Promise<void>

  /**
   * Destroys the client sockets, rolling back their open transactions, stops
   * listening and waits for the message being executed. The PGlite instance
   * is left open: it belongs to the caller.
   */
  close(): Promise<void>
}

// What Postgres reports once `max_connections` is reached.
const TOO_MANY_CLIENTS: Termination = { code: '53300', message: 'sorry, too many clients already' }

// What Postgres reports while it starts up or recovers: the closest standard
// code for an instance that cannot be served right now.
const notReady = (reason: string, hint?: string): Termination => ({
  code: '57P03',
  message: `PGlite is not ready: ${reason}`,
  hint,
})

// Wildcard addresses accept connections but are not a destination on every
// platform, so the URL points at the loopback interface instead.
const CONNECTABLE_HOSTS: Record<string, string> = { '0.0.0.0': '127.0.0.1', '::': '::1' }

interface Listening {
  server: Server
  address: { host: string; port: number } | { path: string; port: number }
}

// The instance being served, with what its clients share.
interface Served {
  backend: Backend
  serverParameters: Map<string, string>
  connections: Set<Connection>
  unsubscribe: () => void
}

/**
 * Creates a Postgres wire-protocol server in front of `db`. The server neither
 * opens nor closes `db`. With `null` it refuses clients (SQLSTATE 57P03) until
 * `serve()` hands it an instance, e.g. one whose creation failed and is
 * retried.
 */
export function createPGliteSocketServer(
  db: PGlite | null,
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

  // What to serve, kept while not listening; exactly one of them is set.
  let instance = db ?? undefined
  let refusal = db ? undefined : notReady('no instance to serve yet')

  let current: Listening | undefined
  let served: Served | undefined
  let listening: Promise<PGliteSocketServer> | undefined
  let closing: Promise<void> | undefined

  // Starting, stopping and switching instances run one at a time: each reads
  // and replaces what the previous one left.
  let queue: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)

    queue = run.catch(() => {})

    return run
  }

  const onError = (error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ECONNRESET') {
      return
    }

    logger('Unexpected connection error:', error)
  }

  const attach = async (target: PGlite): Promise<Served> => {
    const [serverParameters, sessionSettings] = await Promise.all([
      readServerParameters(target),
      readSessionSettings(target),
    ])
    const backend = new Backend(target, { idleInTransactionTimeout, sessionSettings })

    return {
      backend,
      serverParameters,
      connections: new Set(),
      unsubscribe: routeNotifications(target, backend),
    }
  }

  const detach = async ({ backend, connections: clients, unsubscribe }: Served) => {
    unsubscribe()

    // Destroying releases the sessions first, so that the backend still
    // cleans up after them while it closes.
    const socketsClosed = Array.from(clients, (connection) => connection.destroy())

    await Promise.all([backend.close(), ...socketsClosed])
  }

  // How a new client's handshake ends: in a session on the served instance,
  // or in an error when there is none or no room for one more client.
  const admit = (target: Served | undefined, processId: number): ConnectionOptions => {
    if (!target) {
      return { onError, processId, refusal: refusal ?? notReady('switching instances') }
    }

    if (admitted >= maxConnections) {
      return { onError, processId, refusal: TOO_MANY_CLIENTS }
    }

    return {
      backend: target.backend,
      onError,
      processId,
      serverParameters: target.serverParameters,
    }
  }

  const accept = (socket: Socket) => {
    const target = served
    const admission = admit(target, nextProcessId++)
    const counted = !admission.refusal
    const connection = serveConnection(socket, admission)

    if (counted) {
      admitted++
    }

    connections.add(connection)
    target?.connections.add(connection)

    socket.once('close', () => {
      connections.delete(connection)
      target?.connections.delete(connection)

      if (counted) {
        admitted--
      }
    })
  }

  const start = async (): Promise<PGliteSocketServer> => {
    const target = instance && (await attach(instance))

    try {
      current = await bind()
    } catch (error) {
      if (target) {
        await detach(target)
      }

      throw error
    }

    served = target

    return socketServer
  }

  const bind = async (): Promise<Listening> => {
    const server = createServer(accept)

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

    return {
      server,
      address:
        typeof address === 'string'
          ? { path: path ?? address, port: socketPort }
          : { host: address.address, port: address.port },
    }
  }

  const stop = async () => {
    const stopping = current
    const detaching = served

    current = undefined
    served = undefined
    listening = undefined

    if (!stopping) {
      return
    }

    const serverClosed = new Promise<void>((resolve, reject) => {
      stopping.server.close((error) => (error ? reject(error) : resolve()))
    })

    // Long-lived clients (pools, LISTEN) would otherwise keep the server
    // open; refused clients are not attached to an instance.
    const socketsClosed = Array.from(connections, (connection) => connection.destroy())

    await Promise.all([serverClosed, detaching && detach(detaching), ...socketsClosed])
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
      listening ??= (closing ?? Promise.resolve())
        .then(() => exclusive(start))
        .catch((error: unknown) => {
          listening = undefined

          throw error
        })

      return listening
    },

    serve(target) {
      return exclusive(async () => {
        const previous = served

        // Clients arriving during the switch are refused rather than queued
        // on a backend about to close.
        served = undefined
        instance = undefined
        refusal = undefined

        if (previous) {
          await detach(previous)
        }

        if (current) {
          try {
            served = await attach(target)
          } catch (error) {
            refusal = notReady(error instanceof Error ? error.message : String(error))

            throw error
          }
        }

        instance = target
      })
    },

    refuse(reason, { hint } = {}) {
      return exclusive(async () => {
        const previous = served

        served = undefined
        instance = undefined
        refusal = notReady(reason.message, hint)

        if (previous) {
          await detach(previous)
        }
      })
    },

    close() {
      // A start in progress finishes first, so that it is torn down too.
      closing ??= (listening ?? Promise.resolve())
        .catch(() => {})
        .then(() => exclusive(stop))
        .finally(() => {
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
