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
  readStartupPacket,
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
}

export interface ConnectionOptions {
  backend: Backend

  /**
   * Unique per connection. Reported as the backend process id and used to
   * namespace the connection's prepared statements.
   */
  processId: number

  /**
   * Reported to the client through ParameterStatus during the handshake.
   */
  serverParameters: ReadonlyMap<string, string>

  /**
   * When set, the handshake ends with this error instead of opening a session
   * on the backend.
   */
  refusal?: Termination

  onError: (error: unknown) => void
}

export interface Connection {
  /**
   * Writes a backend message that is not the response to one of the client's
   * own, once the handshake has completed.
   */
  notify(message: Uint8Array): void

  /**
   * Releases the session on the backend right away and destroys the socket.
   * Resolves once the socket has closed.
   */
  destroy(): Promise<void>
}

// Emulates the startup handshake, then frames the client's messages and hands
// them to the shared backend.
export function serveConnection(
  socket: Socket,
  { backend, onError, processId, refusal, serverParameters }: ConnectionOptions,
): Connection {
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

  // Ends the connection at the client's request. The session is released once
  // the socket has closed, so the messages queued before still run.
  const close = () => {
    phase = 'closed'
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
  const terminate = ({ code, message }: Termination) => {
    release()

    if (socket.writable) {
      socket.end(buildErrorResponse({ code, message, severity: 'FATAL' }), () => socket.destroy())
    } else {
      socket.destroy()
    }
  }

  const openSession = (): Session =>
    backend.openSession({
      onResponse: write,
      onError(error) {
        onError(error)
        socket.destroy()
      },
      onIdleInTransactionTimeout() {
        terminate({
          code: '25P03',
          message: 'terminating connection due to idle-in-transaction timeout',
        })
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
          if (refusal) {
            terminate(refusal)

            break
          }

          if (packet.protocolVersion !== PROTOCOL_VERSION_3_0) {
            throw new ProtocolError(
              `Unsupported frontend protocol ${String(packet.protocolVersion >> 16)}.${String(packet.protocolVersion & 0xffff)}: the server supports 3.0.`,
            )
          }

          // The startup parameters (user, database, options) are not validated:
          // the server trusts every client and has one database.
          session = openSession()
          write(
            concatBytes(
              buildAuthenticationOk(),
              ...Array.from(serverParameters, ([name, value]) => buildParameterStatus(name, value)),
              buildBackendKeyData(processId, 0),
              buildReadyForQuery('I'),
            ),
          )
          phase = 'ready'

          break
      }
    }
  }

  const readMessages = (active: Session) => {
    const { messages, rest } = splitMessages(buffer)
    const forwarded: Uint8Array[] = []

    buffer = rest

    for (const message of messages) {
      // PGlite keeps its session alive on Terminate, so it is not forwarded.
      if (message[0] === FrontendMessage.Terminate) {
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

      forwarded.push(rewritten.message)
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
    notify(message) {
      if (phase === 'ready') {
        write(message)
      }
    },

    destroy() {
      release()
      socket.destroy()

      return closed
    },
  }
}
