import type { Extensions, PGlite } from '@electric-sql/pglite'

import type { PGliteConfig, PGliteInstanceFor } from '../core/config'
import { createInstance } from '../core/instance'
import type { PGliteClass } from '../core/instance'
import { resolveEnvConfig } from '../core/kind'
import type { EnvOverrides } from '../core/kind'
import { resolveSocketEnv } from '../socket/env'
import type { SocketEnvOptions } from '../socket/env'
import { createPGliteSocketServer } from '../socket/server'
import type { PGliteSocketServer, PGliteSocketServerOptions } from '../socket/server'
import { loadPGliteConfig, TEST_ENV } from './config'

/**
 * The module's `pglite.socket` options, `actions` aside (`env` and `provider`
 * resolve the variables as in `nuxt dev`), plus the server's own (`user`,
 * `database`, `logger`).
 */
export interface TestSocketOptions extends PGliteSocketServerOptions, SocketEnvOptions {}

export interface TestDatabaseOptions<E extends Extensions = {}> {
  /**
   * The app's server config, or the path of its file (`server/pglite.config`,
   * see `loadPGliteConfig`). `$test` overrides apply.
   * @default {}
   */
  config?: (PGliteConfig<E> & EnvOverrides<PGliteConfig<E>>) | string

  /**
   * Import aliases a `config` path may use (`~~`, `#pglite/*`, …), name to
   * absolute path, as `nuxt.options.alias` holds them; see `loadPGliteConfig`.
   */
  alias?: Record<string, string>

  /**
   * Overrides `config.dataDir`: in memory by default, so that a suite never
   * touches the app's data.
   * @default 'memory://'
   */
  dataDir?: string

  /**
   * Serves the instance over the Postgres wire protocol, for code that
   * connects through a URL; `true` listens on a free loopback port.
   * @default false
   */
  socket?: boolean | TestSocketOptions

  /**
   * Sets the socket's variables on `process.env`, those still unset only, for
   * as long as the database is open: code reading `DATABASE_URL` (or the
   * provider's variables) reaches it unchanged.
   * @default true when `socket` is on
   */
  exportEnv?: boolean
}

export interface TestDatabase<E extends Extensions = {}> {
  pg: PGliteInstanceFor<PGliteConfig<E>>

  /** Connection URL, when served over the socket. */
  url?: string

  /** The socket's variables with their values, exported or not; empty without a socket. */
  env: Record<string, string>

  /**
   * A fresh, isolated in-memory copy of this database's current state, with
   * the same extensions; `init` is not run again. It has its own socket when
   * this one has one (on a free port), or as `socket` says. It never exports
   * variables: pass its `env` on instead.
   */
  fork(options?: { socket?: boolean | TestSocketOptions }): Promise<TestDatabase<E>>

  /**
   * Closes the forks still open, the socket and the instance (after the
   * config's `dispose`), and unsets the variables it exported.
   */
  close(): Promise<void>
}

/**
 * Creates a PGlite database from the app's own config, `init` included, for
 * a test suite: shared by a whole run, or isolated per test through `fork()`.
 */
export function createTestDatabase<E extends Extensions = {}>(
  options?: TestDatabaseOptions<E>,
): Promise<TestDatabase<E>>
// `E` only types the instance handed out; the implementation works on the
// config as PGlite and the socket see it.
export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const { alias, config: input = {}, dataDir = 'memory://', socket = false } = options
  const { exportEnv = Boolean(socket) } = options

  const [{ PGlite }, loaded] = await Promise.all([
    // Deferred, like the provider's: `@electric-sql/pglite` is an optional peer.
    import('@electric-sql/pglite'),
    typeof input === 'string'
      ? loadPGliteConfig(input, { alias })
      : resolveEnvConfig(input, TEST_ENV),
  ])
  // A custom `fs` holds the app's own data directory and takes the place of
  // `dataDir`: the test database would write to the app's data.
  const { fs: _fs, ...rest } = loaded
  const config: PGliteConfig = { ...rest, dataDir }
  const pg = await createInstance(PGlite, config)

  return openDatabase(PGlite, config, pg, { socket, exportEnv, dispose: true })
}

interface OpenOptions {
  socket: boolean | TestSocketOptions
  exportEnv: boolean
  /** Whether closing runs the config's `dispose`: only for the instance `init` ran on. */
  dispose: boolean
  onClose?: () => void
}

/** Serves `pg` as asked and wraps it; `pg` and the socket are closed if serving fails. */
async function openDatabase(
  PGlite: PGliteClass,
  config: PGliteConfig,
  pg: PGlite,
  { socket, exportEnv, dispose, onClose }: OpenOptions,
): Promise<TestDatabase> {
  let server: PGliteSocketServer | undefined
  let env: Record<string, string> = {}
  if (socket) {
    const { env: names, provider, ...serverOptions } = socket === true ? {} : socket
    const created = createPGliteSocketServer(pg, serverOptions)
    try {
      await created.listen()
      // Inside the try: an `env` function may throw.
      env = resolveSocketEnv({ env: names, provider }, created.url)
    } catch (error) {
      // The socket first: closing it waits for the message running on `pg`.
      await created.close()
      await pg.close()
      throw error
    }
    server = created
  }
  const exported = exportEnv ? setUnsetVariables(env) : {}

  const forks = new Set<TestDatabase>()
  let closing: Promise<void> | undefined

  const shutdown = async () => {
    // Settled rather than raced: the instance is closed only once nothing
    // runs on it any more, whatever failed.
    const settled = await Promise.allSettled([
      ...[...forks].map((child) => child.close()),
      server?.close(),
    ])
    try {
      if (dispose) {
        await config.dispose?.(pg)
      }
    } finally {
      unsetVariables(exported)
      await pg.close()
      onClose?.()
    }
    const failed = settled.find((result) => result.status === 'rejected')
    if (failed) {
      throw failed.reason
    }
  }

  const assertOpen = () => {
    if (closing) {
      throw new Error('[nuxt-pglite] The test database is closed, so it cannot be forked.')
    }
  }

  return {
    pg,
    url: server?.url,
    env,
    async fork({ socket: forkSocket = inheritSocket(socket) } = {}) {
      assertOpen()
      const snapshot = await pg.dumpDataDir('none')
      // In memory whatever the parent's `dataDir`, which PGlite allows one
      // instance at a time; a custom `fs` belongs to the parent's instance.
      const { dataDir: _dataDir, fs: _fs, ...options } = config
      const copy = await PGlite.create({ ...options, loadDataDir: snapshot })
      const child = await openDatabase(PGlite, config, copy, {
        socket: forkSocket,
        exportEnv: false,
        dispose: false,
        onClose: () => forks.delete(child),
      })
      // The parent closed meanwhile, without this one among its forks.
      if (closing) {
        await child.close()
        assertOpen()
      }
      forks.add(child)
      return child
    },
    close() {
      closing ??= shutdown()
      return closing
    },
  }
}

/**
 * A fork's socket when it asks for nothing: the parent's options without the
 * address, which the parent holds, so that it listens on a free port.
 */
function inheritSocket(socket: boolean | TestSocketOptions): boolean | TestSocketOptions {
  if (typeof socket !== 'object') {
    return socket
  }
  const { port: _port, path: _path, ...rest } = socket
  return rest
}

/**
 * Sets each variable that is still unset, as the development socket does, so
 * that a database configured in the environment wins; returns those it set.
 * An empty value counts as set: it was set on purpose.
 */
function setUnsetVariables(variables: Record<string, string>): Record<string, string> {
  const exported: Record<string, string> = {}
  for (const [name, value] of Object.entries(variables)) {
    if (process.env[name] === undefined) {
      process.env[name] = value
      exported[name] = value
    }
  }
  return exported
}

/** Unsets the variables that still hold the values it set. */
function unsetVariables(exported: Record<string, string>): void {
  for (const [name, value] of Object.entries(exported)) {
    if (process.env[name] === value) {
      delete process.env[name]
    }
  }
}
