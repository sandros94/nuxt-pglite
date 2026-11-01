import { clearTimeout, setTimeout } from 'node:timers'

import type { PGlite } from '@electric-sql/pglite'

import {
  COPY_FROM_STDIN_REJECTION,
  FrontendMessage,
  buildErrorResponse,
  buildNotificationResponse,
  buildQuery,
  buildReadyForQuery,
  buildSync,
  concatBytes,
  deallocateByPrefix,
  hasErrorResponse,
  isCopyFromStdin,
  lastReadyForQueryStatus,
  parseListenStatement,
  quoteIdentifier,
  quoteLiteral,
  readQueryText,
  replaceQueryText,
  stripNotifications,
  type ListenStatement,
  type TransactionStatus,
} from './protocol'

// What Postgres answers a cancelled query with.
const QUERY_CANCELED = buildErrorResponse({
  code: '57014',
  message: 'canceling statement due to user request',
  severity: 'ERROR',
})

// The frontend messages answered with ReadyForQuery: each ends a query, which
// is what a cancel aborts.
const QUERY_ENDS = new Set<number>([
  FrontendMessage.Query,
  FrontendMessage.Sync,
  FrontendMessage.FunctionCall,
])

export interface BackendOptions {
  /**
   * Milliseconds the owner may leave the backend idle inside a transaction
   * before `onIdleInTransactionTimeout` fires. 0 disables the timeout.
   */
  idleInTransactionTimeout?: number

  /**
   * Session settings as the in-process code left them, restored after a
   * client's `RESET ALL` so that disconnecting clients do not wipe them.
   */
  sessionSettings?: { name: string; setting: string }[]
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

  /**
   * Receives a NotificationResponse for a channel the session has LISTENed to.
   */
  onNotification: (message: Uint8Array) => void
}

export interface Session {
  /**
   * Queues complete frontend messages for the backend.
   */
  send(messages: Uint8Array[]): void

  /**
   * Ends the session: rolls back the transaction it left open and
   * deallocates its prepared statements. With `drain`, the messages queued
   * before are still run first (a client's own Terminate); otherwise they are
   * discarded.
   */
  release(options?: { drain?: boolean }): void

  /**
   * Cancels the client's next query while it waits for the backend: it is
   * dropped and answered with SQLSTATE 57014 (`query_canceled`), as Postgres
   * answers a cancelled one; the queries after it still run. A query in
   * PGlite cannot be interrupted, so a cancel for the session owning the
   * backend does nothing.
   */
  cancel(): void
}

// The backend session as the clients see it: it begins with the first client
// and ends with the last one.
interface SharedSession {
  /** Clients on it not yet released. */
  open: number

  /** Clients on it not yet cleaned up after. */
  remaining: number
}

interface SessionState {
  handlers: SessionHandlers
  shared: SharedSession
  messages: Uint8Array[]

  /** Channels the client has LISTENed to. */
  channels: Set<string>

  /**
   * LISTEN / UNLISTEN parsed from an extended-protocol pipeline, applied once
   * the pipeline has synced without error: only then has the backend run them.
   */
  pendingListens: ListenStatement[]
  pipelineErrored: boolean

  /**
   * Cancelled before its pipeline's Sync arrived: what comes up to the Sync is
   * discarded, as the backend does after an error.
   */
  skippingToSync?: boolean

  /** Released by the client's own Terminate: queued messages still run. */
  draining?: boolean

  /**
   * ReadyForQuery status of the last response, undefined when it had none
   * (mid-pipeline).
   */
  status?: TransactionStatus

  /**
   * Prefix of the session's prepared statement names: the statements left
   * with it are deallocated when the session is cleaned up.
   */
  statementPrefix: string

  /** Set once the client has gone away. */
  released?: boolean

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
 *
 * Session state (settings, temp tables, advisory locks) is shared by every
 * client as well. Like a real session's, it is dropped when the session ends:
 * here once its last client has disconnected and been cleaned up after.
 */
export class Backend {
  #db: PGlite
  #idleInTransactionTimeout: number
  #owner?: SessionState

  // Sessions waiting for ownership, in arrival order. `Set` makes re-queueing
  // an already waiting session a no-op.
  #waiting = new Set<SessionState>()

  #shared: SharedSession = { open: 0, remaining: 0 }

  #closed = false
  #pumping?: Promise<void>
  #running = false

  // Armed while the owner sits idle inside a transaction.
  #idleTimer?: ReturnType<typeof setTimeout>

  // Sessions per channel: PGlite has one LISTEN set, so notifications are
  // routed here to the clients that asked for them.
  #listeners = new Map<string, Set<SessionState>>()

  #sessionSettings: { name: string; setting: string }[]

  // Ends the hold on PGlite's locks while a client owns the backend.
  #endSpan?: () => void

  constructor(
    db: PGlite,
    { idleInTransactionTimeout = 0, sessionSettings = [] }: BackendOptions = {},
  ) {
    this.#db = db
    this.#idleInTransactionTimeout = idleInTransactionTimeout
    this.#sessionSettings = sessionSettings
  }

  openSession(
    handlers: SessionHandlers,
    { statementPrefix }: { statementPrefix: string },
  ): Session {
    const state: SessionState = {
      handlers,
      statementPrefix,
      shared: this.#shared,
      messages: [],
      channels: new Set(),
      pendingListens: [],
      pipelineErrored: false,
    }

    state.shared.open++
    state.shared.remaining++

    return {
      send: (messages) => {
        if (this.#closed || state.released) {
          return
        }

        let pending = messages
        if (state.skippingToSync) {
          const sync = messages.findIndex((message) => message[0] === FrontendMessage.Sync)
          if (sync === -1) {
            return
          }

          // Cancelled while waiting, so outside of a transaction.
          state.skippingToSync = false
          state.handlers.onResponse(buildReadyForQuery('I'))
          pending = messages.slice(sync + 1)
        }

        if (pending.length === 0) {
          return
        }

        state.messages.push(...pending)

        if (this.#owner === state) {
          this.#clearIdleTimer()
        } else {
          this.#waiting.add(state)
        }

        this.#kick()
      },

      // Still honoured after `close`, so that the sessions torn down with the
      // server leave no transaction or prepared statement behind.
      release: ({ drain = false } = {}) => {
        if (state.released) {
          return
        }

        state.draining = drain && state.messages.length > 0
        if (!state.draining) {
          state.messages.length = 0
        }
        state.released = true
        state.releasedAsOwner = this.#owner === state

        // Clients opened from now on join a new shared session. They queue
        // behind the turns of this one's clients, so its state is dropped
        // before they run anything.
        if (--state.shared.open === 0) {
          this.#shared = { open: 0, remaining: 0 }
        }

        if (state.releasedAsOwner) {
          this.#clearIdleTimer()
        }

        // Every session gets a cleanup turn: its prepared statements and
        // LISTENs live in the shared backend, and the last one's turn ends the
        // shared session.
        if (!state.releasedAsOwner) {
          this.#waiting.add(state)
        }

        this.#kick()
      },

      // A session not owning the backend gave it up idle, between two
      // queries, so its queue starts with a query none of which is in PGlite.
      // The owner's query is in PGlite, or the owner sits idle in a
      // transaction, where Postgres ignores a cancel as well.
      cancel: () => {
        if (
          this.#closed ||
          state.released ||
          this.#owner === state ||
          state.messages.length === 0
        ) {
          return
        }

        const end = state.messages.findIndex((message) => QUERY_ENDS.has(message[0] ?? 0))
        const synced = end !== -1

        state.messages.splice(0, synced ? end + 1 : state.messages.length)
        state.skippingToSync = !synced
        if (state.messages.length === 0) {
          this.#waiting.delete(state)
        }

        state.handlers.onResponse(
          synced ? concatBytes(QUERY_CANCELED, buildReadyForQuery('I')) : QUERY_CANCELED,
        )
      },
    }
  }

  /**
   * Delivers a notification to the sessions listening on its channel.
   */
  notify(channel: string, payload: string): void {
    const sessions = this.#listeners.get(channel)
    if (!sessions) {
      return
    }

    const message = buildNotificationResponse(channel, payload)
    for (const session of sessions) {
      session.handlers.onNotification(message)
    }
  }

  // Stops forwarding messages and waits for the message being executed and for
  // the cleanup of the sessions released so far, so that the PGlite instance
  // is left without a client's transaction open.
  async close(): Promise<void> {
    this.#closed = true
    this.#clearIdleTimer()

    // A turn in progress ends the hold itself, after what it still runs under
    // the locks (a cleanup's ROLLBACK); an idle owner's hold ends now.
    if (!this.#running) {
      this.#releaseLocks()
    }

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
        const owner = this.#owner ?? (await this.#takeNextWaiting())

        if (!owner) {
          return
        }

        this.#owner = owner

        // Once closed, what a leaving client queued no longer runs: it only
        // gets its cleanup.
        const draining = owner.draining && owner.messages.length > 0 && !this.#closed

        if (owner.released && !draining) {
          await this.#holdLocks()
          await this.#cleanUp(owner)
          this.#owner = undefined
          this.#releaseLocks()

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
          await this.#holdLocks()
          await this.#forward(owner)
        } catch (error) {
          owner.handlers.onError(error)

          // Released by its handler: the cleanup turn comes next, as `#kick`
          // does nothing while this turn runs.
          if (Backend.#isReleased(owner)) {
            continue
          }

          return
        }
      }
    } finally {
      this.#running = false

      // A closed backend serves no one: no hold on the locks outlasts the turn.
      if (this.#closed) {
        this.#releaseLocks()
      }
    }
  }

  // A session owns the backend once PGlite's locks are held, i.e. once the
  // app's own statements are done: until then it is waiting, and its query can
  // still be cancelled.
  async #takeNextWaiting(): Promise<SessionState | undefined> {
    if (this.#waiting.size === 0) {
      return undefined
    }

    await this.#holdLocks()

    const next = this.#waiting.values().next()

    if (next.done) {
      this.#releaseLocks()

      return undefined
    }

    this.#waiting.delete(next.value)

    return next.value
  }

  // PGlite's in-process API takes a transaction lock for `transaction()` and a
  // query lock per statement. Both are held for as long as a client owns the
  // backend, so that the app's own statements cannot land inside the client's
  // transaction or pipeline, and the client's cannot land inside the app's.
  async #holdLocks(): Promise<void> {
    if (this.#endSpan) {
      return
    }

    await new Promise<void>((held) => {
      // Underscored in PGlite but part of its public base class: the same two
      // locks `transaction()` and `query()` take, in the same order.
      // oxlint-disable-next-line no-underscore-dangle
      void this.#db._runExclusiveTransaction(() =>
        // oxlint-disable-next-line no-underscore-dangle
        this.#db._runExclusiveQuery(
          () =>
            new Promise<void>((end) => {
              this.#endSpan = end
              held()
            }),
        ),
      )
    })
  }

  #releaseLocks(): void {
    this.#endSpan?.()
    this.#endSpan = undefined
  }

  // Forwards the owner's queued messages one at a time until the queue runs
  // dry or the backend is idle.
  async #forward(owner: SessionState): Promise<void> {
    {
      while (!this.#closed && !Backend.#isDone(owner)) {
        let message = owner.messages.shift()

        if (!message) {
          return
        }

        const text = readQueryText(message)
        if (text !== undefined && isCopyFromStdin(text)) {
          message = replaceQueryText(message, COPY_FROM_STDIN_REJECTION)
        }
        const listen = text === undefined ? undefined : parseListenStatement(text)

        // Durability is settled once per turn, not per message.
        const response = await this.#db.execProtocolRaw(message, { syncToFs: false })

        owner.handlers.onResponse(stripNotifications(response))
        owner.status = lastReadyForQueryStatus(response)

        const errored = hasErrorResponse(response)
        if (listen) {
          if (message[0] === FrontendMessage.Query) {
            if (!errored) {
              await this.#trackListen(owner, listen)
            }
          } else {
            owner.pendingListens.push(listen)
          }
        }
        owner.pipelineErrored ||= errored
        if (owner.status !== undefined) {
          if (!owner.pipelineErrored) {
            for (const pending of owner.pendingListens) {
              await this.#trackListen(owner, pending)
            }
          }
          owner.pendingListens = []
          owner.pipelineErrored = false
        }

        // `T` and `E` keep ownership (transaction affinity), and so does a
        // response without ReadyForQuery (pipeline not yet synced, COPY in
        // progress). A session released meanwhile keeps ownership so that
        // `#pump` runs its cleanup next.
        if (owner.status === 'I' && !Backend.#isReleased(owner)) {
          await this.#db.syncToFs()
          this.#owner = undefined
          this.#releaseLocks()

          if (owner.messages.length > 0) {
            this.#waiting.add(owner)
          }

          return
        }
      }
    }
  }

  // `release` can run while a turn awaits the backend. Read through a call,
  // TypeScript would otherwise keep the loop condition's narrowing across the
  // `await`.
  static #isReleased(session: SessionState): boolean {
    return session.released === true
  }

  // Released and not draining: nothing more of the client's is to be run.
  static #isDone(session: SessionState): boolean {
    return session.released === true && !session.draining
  }

  // Like Postgres' `idle_in_transaction_session_timeout`, for an owner inside
  // a transaction ('T' / 'E') and also for one that stopped mid-pipeline (no
  // ReadyForQuery yet): either holds every other client. An armed timer is
  // left running, as the idle period it measures has not ended: the timer is
  // cleared whenever the owner sends or is released.
  #armIdleTimer(owner: SessionState): void {
    if (this.#idleInTransactionTimeout <= 0 || this.#idleTimer !== undefined) {
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

  // Applies a LISTEN / UNLISTEN the client just ran to the routing table and
  // keeps PGlite's own LISTEN set equal to the union of every client's: an
  // UNLISTEN by one client must not silence the others.
  async #trackListen(
    session: SessionState,
    { kind, channel }: { kind: 'listen' | 'unlisten'; channel: string },
  ) {
    if (kind === 'listen') {
      session.channels.add(channel)
      this.#listeners.set(channel, (this.#listeners.get(channel) ?? new Set()).add(session))

      return
    }

    const dropped = channel === '*' ? [...session.channels] : [channel]
    for (const name of dropped) {
      this.#unsubscribe(session, name)
    }

    const stillListened =
      channel === '*'
        ? [...this.#listeners.keys()]
        : dropped.filter((name) => this.#listeners.has(name))
    for (const name of stillListened) {
      await this.#db.execProtocolRaw(buildQuery(`LISTEN ${quoteIdentifier(name)}`), {
        syncToFs: false,
      })
    }
  }

  #unsubscribe(session: SessionState, channel: string): void {
    session.channels.delete(channel)

    const sessions = this.#listeners.get(channel)
    sessions?.delete(session)
    if (sessions?.size === 0) {
      this.#listeners.delete(channel)
    }
  }

  async #cleanUp(session: SessionState): Promise<void> {
    const ended = --session.shared.remaining === 0
    const channels = [...session.channels]
    for (const channel of channels) {
      this.#unsubscribe(session, channel)
    }

    const raw = (message: Uint8Array) => this.#db.execProtocolRaw(message, { syncToFs: false })

    try {
      if (session.releasedAsOwner) {
        // A client gone mid-pipeline leaves the backend skipping messages
        // until a Sync; only then does a ROLLBACK get through.
        await raw(buildSync())
        if (this.#db.isInTransaction()) {
          await raw(buildQuery('ROLLBACK'))
        }
      }

      // Found by prefix when the cleanup runs, whichever messages, run or
      // drained, created them.
      await raw(buildQuery(deallocateByPrefix(session.statementPrefix)))

      const reset = channels
        .filter((channel) => !this.#listeners.has(channel))
        .map((channel) => `UNLISTEN ${quoteIdentifier(channel)}`)

      // The shared session ended: its state goes, as a real server's would
      // with the connection. Not DISCARD ALL: the in-process code shares the
      // session, and would lose its prepared statements and LISTENs. The
      // settings it had set are put back afterwards.
      if (ended) {
        reset.push(
          'RESET ALL',
          ...this.#sessionSettings.map(
            ({ name, setting }) =>
              `SELECT set_config(${quoteLiteral(name)}, ${quoteLiteral(setting)}, false)`,
          ),
          'SELECT pg_advisory_unlock_all()',
          'DISCARD TEMP',
        )
      }

      if (reset.length > 0) {
        await raw(buildQuery(reset.join('; ')))
      }
      await this.#db.syncToFs()
    } catch (error) {
      session.handlers.onError(error)
    }
  }
}
