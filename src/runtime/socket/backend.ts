import { clearTimeout, setTimeout } from 'node:timers'

import type { PGlite } from '@electric-sql/pglite'

import {
  buildCloseStatement,
  buildQuery,
  buildSync,
  concatBytes,
  lastReadyForQueryStatus,
  stripNotifications,
  type TransactionStatus,
} from './protocol'

export interface BackendOptions {
  /**
   * Milliseconds the owner may leave the backend idle inside a transaction
   * before `onIdleInTransactionTimeout` fires. 0 disables the timeout.
   */
  idleInTransactionTimeout?: number
}

export interface SessionHandlers {
  /**
   * Receives the response to each forwarded message, without the
   * NotificationResponse messages (those are broadcast separately).
   */
  onResponse: (response: Uint8Array) => void

  /**
   * Receives failures while forwarding the session's messages or cleaning up
   * after it.
   */
  onError: (error: unknown) => void

  /**
   * Fires when the session owns the backend inside a transaction, with
   * nothing queued, for longer than `idleInTransactionTimeout`. The session is
   * expected to release itself, which rolls the transaction back.
   */
  onIdleInTransactionTimeout: () => void
}

export interface Session {
  /**
   * Queues complete frontend messages for the backend.
   */
  send(messages: Uint8Array[]): void

  /**
   * Ends the session: discards its queued messages, rolls back the transaction
   * it left open and closes the given prepared statements.
   */
  release(statements: Iterable<string>): void
}

interface SessionState {
  handlers: SessionHandlers
  messages: Uint8Array[]

  /**
   * ReadyForQuery status of the last response, undefined when it had none
   * (mid-pipeline).
   */
  status?: TransactionStatus

  /**
   * Set once the client has gone away: the prepared statements to close.
   */
  released?: string[]

  /**
   * Whether the session owned the backend when released, i.e. whether an open
   * transaction belongs to it.
   */
  releasedAsOwner?: boolean
}

/**
 * PGlite is a single backend session shared by every client socket.
 *
 * Forwarding messages as they arrive lets clients corrupt each other's state:
 * interleaved extended-protocol pipelines bind to someone else's statement,
 * and a query runs inside another client's transaction. Instead, one client
 * owns the backend at a time and keeps it until a `ReadyForQuery` reports it
 * idle (`'I'`), so a pipeline (`Parse … Sync`) and a transaction block (`BEGIN …
 * COMMIT`) run without interference while the other clients queue in arrival
 * order.
 */
export class Backend {
  #db: PGlite
  #idleInTransactionTimeout: number
  #owner?: SessionState

  // Sessions waiting for ownership, in arrival order. `Set` makes re-queueing
  // an already waiting session a no-op.
  #waiting = new Set<SessionState>()

  #closed = false
  #pumping?: Promise<void>
  #running = false

  // Armed while the owner sits idle inside a transaction.
  #idleTimer?: ReturnType<typeof setTimeout>

  constructor(db: PGlite, { idleInTransactionTimeout = 0 }: BackendOptions = {}) {
    this.#db = db
    this.#idleInTransactionTimeout = idleInTransactionTimeout
  }

  openSession(handlers: SessionHandlers): Session {
    const state: SessionState = { handlers, messages: [] }

    return {
      send: (messages) => {
        if (this.#closed || state.released || messages.length === 0) {
          return
        }

        state.messages.push(...messages)

        if (this.#owner === state) {
          this.#clearIdleTimer()
        } else {
          this.#waiting.add(state)
        }

        this.#kick()
      },

      // Still honoured after `close`, so that the sessions torn down with the
      // server leave no transaction or prepared statement behind.
      release: (statements) => {
        if (state.released) {
          return
        }

        state.messages.length = 0
        state.released = [...statements]
        state.releasedAsOwner = this.#owner === state

        if (state.releasedAsOwner) {
          this.#clearIdleTimer()
        }

        // A waiting session without prepared statements has nothing left to do
        // on the backend.
        if (!state.releasedAsOwner && state.released.length === 0) {
          this.#waiting.delete(state)

          return
        }

        if (!state.releasedAsOwner) {
          this.#waiting.add(state)
        }

        this.#kick()
      },
    }
  }

  // Stops forwarding messages and waits for the message being executed and for
  // the cleanup of the sessions released so far, so that the PGlite instance
  // is left without a client's transaction open.
  async close(): Promise<void> {
    this.#closed = true
    this.#clearIdleTimer()

    for (const session of this.#waiting) {
      if (!session.released) {
        this.#waiting.delete(session)
      }
    }

    await this.#pumping
  }

  #kick(): void {
    if (this.#running) {
      return
    }

    this.#running = true
    this.#pumping = this.#pump()
  }

  async #pump(): Promise<void> {
    try {
      for (;;) {
        const owner = this.#owner ?? this.#takeNextWaiting()

        if (!owner) {
          return
        }

        this.#owner = owner

        if (owner.released) {
          await this.#cleanUp(owner, owner.released)
          this.#owner = undefined

          continue
        }

        if (this.#closed) {
          return
        }

        // The owner is inside a transaction or a pipeline and the rest has not
        // arrived yet.
        if (owner.messages.length === 0) {
          this.#armIdleTimer(owner)

          return
        }

        try {
          await this.#forward(owner)
        } catch (error) {
          owner.handlers.onError(error)

          return
        }
      }
    } finally {
      this.#running = false
    }
  }

  #takeNextWaiting(): SessionState | undefined {
    const next = this.#waiting.values().next()

    if (next.done) {
      return undefined
    }

    this.#waiting.delete(next.value)

    return next.value
  }

  // Forwards the owner's queued messages one at a time until the queue runs
  // dry or the backend is idle. PGlite's own lock is held for the whole turn so
  // that its in-process API (`query`, `exec`, `transaction`) cannot slip in
  // between the messages. It can still run while the owner waits for more
  // data, as it does not go through this scheduler.
  async #forward(owner: SessionState): Promise<void> {
    await this.#db.runExclusive(async () => {
      while (!this.#closed && !Backend.#isReleased(owner)) {
        const message = owner.messages.shift()

        if (!message) {
          return
        }

        const response = await this.#db.execProtocolRaw(message)

        owner.handlers.onResponse(stripNotifications(response))
        owner.status = lastReadyForQueryStatus(response)

        // `T` and `E` keep ownership (transaction affinity), and so does a
        // response without ReadyForQuery (pipeline not yet synced, COPY in
        // progress). A session released meanwhile keeps ownership so that
        // `#pump` runs its cleanup next.
        if (owner.status === 'I' && !Backend.#isReleased(owner)) {
          this.#owner = undefined

          if (owner.messages.length > 0) {
            this.#waiting.add(owner)
          }

          return
        }
      }
    })
  }

  // `release` can run while a turn awaits the backend. Read through a call,
  // TypeScript would otherwise keep the loop condition's narrowing across the
  // `await`.
  static #isReleased(session: SessionState): boolean {
    return session.released !== undefined
  }

  // Like Postgres' `idle_in_transaction_session_timeout`, only an owner that
  // has received ReadyForQuery 'T' or 'E' counts as idle: mid-pipeline the
  // backend is still waiting for the rest of the pipeline. An armed timer is
  // left running, as the idle period it measures has not ended: the timer is
  // cleared whenever the owner sends or is released.
  #armIdleTimer(owner: SessionState): void {
    if (
      this.#idleInTransactionTimeout <= 0 ||
      this.#idleTimer !== undefined ||
      (owner.status !== 'T' && owner.status !== 'E')
    ) {
      return
    }

    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined

      if (this.#owner === owner) {
        owner.handlers.onIdleInTransactionTimeout()
      }
    }, this.#idleInTransactionTimeout)
  }

  #clearIdleTimer(): void {
    clearTimeout(this.#idleTimer)
    this.#idleTimer = undefined
  }

  async #cleanUp(session: SessionState, statements: string[]): Promise<void> {
    try {
      await this.#db.runExclusive(async () => {
        if (session.releasedAsOwner && this.#db.isInTransaction()) {
          await this.#db.execProtocolRaw(buildQuery('ROLLBACK'))
        }

        if (statements.length > 0) {
          await this.#db.execProtocolRaw(
            concatBytes(...statements.map(buildCloseStatement), buildSync()),
          )
        }
      })
    } catch (error) {
      session.handlers.onError(error)
    }
  }
}
