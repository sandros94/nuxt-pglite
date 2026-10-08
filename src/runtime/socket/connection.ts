import type { Socket } from 'node:net'

import type { PGlite } from '@electric-sql/pglite'

import type { Backend, Session } from './backend'
import {
  FrontendMessage,
  PROTOCOL_VERSION_3_0,
  ProtocolError,
  buildAuthenticationOk,
  buildBackendKeyData,
  buildErrorResponse,
  buildParameterStatus,
  buildReadyForQuery,
  concatBytes,
  quoteIdentifier,
  readQueryText,
  readStartupPacket,
  replaceQueryText,
  rewriteSqlStatementName,
  rewriteStatementName,
  splitMessages,
} from './protocol'

// Settings a real server reports through ParameterStatus after authentication.
// Clients rely on some of them (e.g. `server_version`, `integer_datetimes`).
const REPORTED_PARAMETERS = [
  'server_version',
  'server_encoding',
  'client_encoding',
  'application_name',
  'is_superuser',
  'session_authorization',
  'DateStyle',
  'IntervalStyle',
  'TimeZone',
  'integer_datetimes',
  'standard_conforming_strings',
  'default_transaction_read_only',
  'in_hot_standby',
  'scram_iterations',
]

// Settings PGlite doesn't expose through `pg_settings` are left out.
export async function readServerParameters(db: PGlite): Promise<Map<string, string>> {
  const { rows } = await db.query<{ name: string; setting: string }>(
    'SELECT name, setting FROM pg_settings WHERE name = ANY($1)',
    [REPORTED_PARAMETERS],
  )

  return new Map(rows.map(({ name, setting }) => [name, setting]))
}

// A FATAL error the server ends a connection with.
export interface Termination {
  code: string
  message: string
  hint?: string
}

// Settings the in-process code changed for the session before the server
// started (an `init` hook's `SET search_path`, …), to survive client resets.
export async function readSessionSettings(
  db: PGlite,
): Promise<{ name: string; setting: string }[]> {
  const { rows } = await db.query<{ name: string; setting: string }>(
    "SELECT name, setting FROM pg_settings WHERE source = 'session'",
  )

  return rows
}

export type ConnectionOptions = {
  /**
   * Unique per connection. Reported as the backend process id and used to
   * namespace the connection's prepared statements.
   */
  processId: number

  onError: (error: unknown) => void
} & (
  | {
      backend: Backend

      /**
       * Reported to the client through ParameterStatus during the handshake.
       */
      serverParameters: ReadonlyMap<string, string>

      refusal?: undefined
    }
  | {
      /**
       * The error the handshake ends with instead of opening a session: there
       * may be no backend to open one on.
       */
      refusal: Termination
    }
)

export interface Connection {
  /**
   * Releases the session on the backend right away and destroys the socket.
   * Resolves once the socket has closed.
   */
  destroy(): Promise<void>
}

// Emulates the startup handshake, then frames the client's messages and hands
// them to the shared backend.
export function serveConnection(socket: Socket, options: ConnectionOptions): Connection {
  const { onError, processId } = options

  // Prepared statements live in the single backend session, so two clients
  // preparing the same name would collide. The prefix is short because
  // Postgres keys statements on the first 63 bytes of the name.
  const statementPrefix = `${String(processId)}_`
  const statements = new Set<string>()

  let phase: 'startup' | 'ready' | 'closed' = 'startup'
  let buffer: Uint8Array = new Uint8Array(0)
  let session: Session | undefined

  const closed = new Promise<void>((resolve) => {
    socket.once('close', () => resolve())
  })

  // Responses are written per message, so Nagle's algorithm would hold each
  // one back until the client acknowledges the previous one. Postgres sets
  // TCP_NODELAY on its sockets too.
  socket.setNoDelay(true)

  const write = (bytes: Uint8Array) => {
    if (socket.writable) {
      socket.write(bytes)
    }
  }

  // Ends the connection at the client's request: the messages queued before
  // still run, then the session is cleaned up.
  const close = () => {
    phase = 'closed'
    session?.release(statements, { drain: true })
    socket.end()
  }

  // Releases the session before the socket closes, so the backend is free for
  // the other clients even if the client never reads the error.
  const release = () => {
    phase = 'closed'
    session?.release(statements)
  }

  // Ends the connection at the server's initiative, the way Postgres does:
  // with a FATAL ErrorResponse.
  const terminate = ({ code, hint, message }: Termination) => {
    release()

    if (socket.writable) {
      socket.end(buildErrorResponse({ code, hint, message, severity: 'FATAL' }), () =>
        socket.destroy(),
      )
    } else {
      socket.destroy()
    }
  }

  const openSession = (backend: Backend): Session =>
    backend.openSession({
      onResponse: write,
      onError(error) {
        onError(error)
        // What Postgres reports when the backend dies under a client.
        terminate({ code: '57P01', message: 'terminating connection because of a backend error' })
      },
      onIdleInTransactionTimeout() {
        terminate({
          code: '25P03',
          message: 'terminating connection due to idle-in-transaction timeout',
        })
      },
      onNotification(message) {
        if (phase === 'ready') {
          write(message)
        }
      },
    })

  const readStartup = () => {
    while (phase === 'startup') {
      const result = readStartupPacket(buffer)

      if (!result) {
        return
      }

      buffer = buffer.subarray(result.length)

      const { packet } = result

      switch (packet.kind) {
        // `N` tells the client to continue unencrypted on the same socket.
        case 'ssl-request':
        case 'gssenc-request':
          write(new Uint8Array([0x4e])) // 'N'

          break

        // Queries cannot be cancelled on the single backend.
        case 'cancel-request':
          close()

          break

        case 'startup':
          if (options.refusal) {
            terminate(options.refusal)

            break
          }

          if (packet.protocolVersion !== PROTOCOL_VERSION_3_0) {
            throw new ProtocolError(
              `Unsupported frontend protocol ${String(packet.protocolVersion >> 16)}.${String(packet.protocolVersion & 0xffff)}: the server supports 3.0.`,
            )
          }

          // The startup parameters (user, database, options) are not validated:
          // the server trusts every client and has one database.
          session = openSession(options.backend)
          write(
            concatBytes(
              buildAuthenticationOk(),
              ...Array.from(options.serverParameters, ([name, value]) =>
                buildParameterStatus(name, value),
              ),
              buildBackendKeyData(processId, 0),
              buildReadyForQuery('I'),
            ),
          )
          phase = 'ready'

          break
      }
    }
  }

  // SQL-level prepared statements live in the same namespace as the
  // protocol-level ones. `DEALLOCATE ALL` becomes the client's own statements
  // only, as it would be on a real server.
  const rewriteSqlStatements = (message: Uint8Array): Uint8Array => {
    const text = readQueryText(message)
    if (text === undefined) {
      return message
    }

    const { sql, name } = rewriteSqlStatementName(text, statementPrefix)
    if (name === undefined) {
      return message
    }
    if (name === '*') {
      const own = [...statements].map((statement) => `DEALLOCATE ${quoteIdentifier(statement)}`)
      statements.clear()

      return replaceQueryText(message, own.length > 0 ? own.join('; ') : 'DEALLOCATE ALL')
    }
    if (/^\s*PREPARE/iu.test(text)) {
      statements.add(name)
    } else if (/^\s*DEALLOCATE/iu.test(text)) {
      statements.delete(name)
    }

    return replaceQueryText(message, sql)
  }

  const readMessages = (active: Session) => {
    const { messages, rest } = splitMessages(buffer)
    const forwarded: Uint8Array[] = []

    buffer = rest

    for (const message of messages) {
      // PGlite keeps its session alive on Terminate, so it is not forwarded;
      // what came before it is queued first, so it still runs.
      if (message[0] === FrontendMessage.Terminate) {
        active.send(forwarded)
        forwarded.length = 0
        close()

        break
      }

      const rewritten = rewriteStatementName(message, { prefix: statementPrefix })

      if (rewritten.name !== undefined) {
        if (message[0] === FrontendMessage.Parse) {
          statements.add(rewritten.name)
        } else if (message[0] === FrontendMessage.Close) {
          statements.delete(rewritten.name)
        }
      }

      forwarded.push(rewriteSqlStatements(rewritten.message))
    }

    active.send(forwarded)
  }

  socket.on('data', (chunk: Buffer) => {
    if (phase === 'closed') {
      return
    }

    buffer = buffer.length === 0 ? chunk : concatBytes(buffer, chunk)

    try {
      readStartup()

      if (phase === 'ready' && session) {
        readMessages(session)
      }
    } catch (error) {
      if (error instanceof ProtocolError) {
        terminate(error)
      } else {
        onError(error)
        socket.destroy()
      }
    }
  })

  socket.on('error', onError)

  socket.on('close', release)

  return {
    destroy() {
      release()
      socket.destroy()

      return closed
    },
  }
}
