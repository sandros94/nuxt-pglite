import type { PGliteOptions } from '@electric-sql/pglite'
import type { PGliteWorkerOptions } from '@electric-sql/pglite/worker'
import type { startSubprocess } from '@nuxt/devtools-kit'
import type { SubprocessOptions, TerminalState } from '@nuxt/devtools-kit/types'
import type { NuxtLogger, NuxtTerminal } from '@nuxt/kit'
import type { HookResult } from '@nuxt/schema'

import type { PGliteAction } from './runtime/core/actions'
import type { SocketEnv } from './runtime/socket/env'
import type { SocketProvider } from './runtime/socket/providers'

export type { PGliteAction, PGliteActionInfo, PGliteActionSide } from './runtime/core/actions'
export type { PGliteServerAction, PGliteServerActionContext } from './runtime/core/config'
export type { PGliteClientAction, PGliteClientActionContext } from './runtime/client/config'
export type { SocketEnv } from './runtime/socket/env'
export type { SocketProvider } from './runtime/socket/providers'

/**
 * PGlite options that survive serialization into the build, i.e. everything
 * except extensions, filesystems and data-directory blobs, which belong in the
 * config file where they can be imported.
 */
export type SerializablePGliteOptions = Omit<
  PGliteOptions,
  'extensions' | 'fs' | 'loadDataDir' | 'parsers' | 'serializers'
>

export type SerializablePGliteWorkerOptions = Omit<
  PGliteWorkerOptions,
  'extensions' | 'fs' | 'loadDataDir' | 'parsers' | 'serializers'
>

export interface SocketOptions {
  /** Host to bind, `127.0.0.1` by default. */
  host?: string
  /** Port to bind; a free one is picked by default. */
  port?: number
  /** Unix socket path; takes precedence over `host` and `port`. */
  path?: string
  /**
   * Environment variables exported for the socket, `DATABASE_URL` by default:
   * a name receives the connection URL; a map gives each name a function of
   * the URL or a string exported as is. Each is set only while still unset,
   * so a real database configured in the environment wins, and a warning
   * names any that hold something else once the dev server is up (set
   * before, or overwritten by another module). `false` exports nothing.
   */
  env?: string | false | SocketEnv
  /**
   * Exports the variables a hosting provider sets for its database instead of
   * `DATABASE_URL`, so that code written for it reaches the socket unchanged;
   * `env` is merged over them. `netlify`: `NETLIFY_DB_URL` and
   * `NETLIFY_DB_DRIVER=server`.
   */
  provider?: SocketProvider
  /** Clients allowed at once; unlimited by default. */
  maxConnections?: number
  /** Milliseconds a client may sit idle inside a transaction before it is disconnected; `0` disables it. */
  idleInTransactionTimeout?: number
  /**
   * Actions listed in Nuxt DevTools and the terminal, run in the dev process
   * next to the socket. Other modules add theirs through the
   * `pglite:devtools:actions` hook.
   */
  actions?: PGliteSocketAction[]
}

/**
 * What a `socket` action receives: how to reach the database from outside the
 * app, through the socket.
 */
export interface PGliteSocketActionContext {
  /** Connection URL of the development socket. */
  socketUrl: string
  /**
   * The variables the socket exported, with their values: to pass on to a
   * command so that it reaches the socket as the app does.
   */
  env: Record<string, string>
  /** Data directory the socket serves. Unset for an in-memory database. */
  dataDir?: string
  /**
   * Starts a long-running command whose output streams to its own terminal in
   * Nuxt DevTools (`startSubprocess` from `@nuxt/devtools-kit`).
   */
  startSubprocess: (
    execaOptions: SubprocessOptions,
    tabOptions: TerminalState,
  ) => ReturnType<typeof startSubprocess>
  /** The terminal, cooperating with the `nuxt dev` UI when it runs. */
  terminal: NuxtTerminal
  logger: NuxtLogger
}

/**
 * An action that runs in the dev process next to the socket, reaching the
 * database through its URL: CLIs, migrations, studios.
 */
export type PGliteSocketAction = PGliteAction<PGliteSocketActionContext>

export interface ServerOptions {
  /** Registers `usePGlite()` and the server-side instance. */
  enabled: boolean
  /**
   * Path of the config file, relative to the root directory, extension
   * optional. It exports `definePGliteServerConfig({ ... })` and is where
   * extensions and `init` live. Optional: without it the instance uses the
   * `options` below.
   */
  config: string
  /**
   * Build-time defaults the config file can override. A relative `dataDir`
   * is resolved from the root directory; `.data/pglite` unless set.
   */
  options: SerializablePGliteOptions
  /** Creates the instance when the server starts instead of on first use. */
  eager: boolean
}

export interface ClientOptions {
  /** Registers the in-browser instance and `usePGlite()` / live-query composables. */
  enabled: boolean
  /**
   * Path of the client config file, relative to the root directory, extension
   * optional. It exports `definePGliteClientConfig({ ... })`. Optional.
   */
  config: string
  /** Build-time defaults the config file can override. */
  options: SerializablePGliteWorkerOptions
  /** Starts the worker when the app loads instead of on first use. */
  eager: boolean
}

/** What the module works with: every option has its default. */
export interface ResolvedModuleOptions {
  server: ServerOptions
  client: ClientOptions
  /**
   * Serves the server config's instance over the Postgres wire protocol, so
   * drivers and tools outside the app (`drizzle-kit`, `psql`, …) reach it
   * through a connection URL. Development only, and independent of
   * `server.enabled`.
   */
  socket: boolean | SocketOptions
  /**
   * Adds the PGlite tab to Nuxt DevTools, when DevTools is enabled. Nothing
   * of it is registered outside `nuxt dev`.
   */
  devtools: boolean
}

/** What `nuxt.config` accepts: any part of it, merged over the defaults. */
export interface ModuleOptions {
  server?: Partial<ServerOptions>
  client?: Partial<ClientOptions>
  socket?: boolean | SocketOptions
  devtools?: boolean
}

/**
 * Build-time hooks; `@nuxt/module-builder` emits the matching `NuxtHooks`
 * augmentation into `dist/types.d.mts`.
 */
export interface ModuleHooks {
  /**
   * Collects the `socket` actions, once every module is set up: push to the
   * array. Called in development only, while the socket runs.
   */
  'pglite:devtools:actions': (actions: PGliteSocketAction[]) => HookResult
  /**
   * Opens the action picker in the terminal of an interactive `nuxt dev`.
   * Registered only there, and only when there are actions to pick from.
   */
  'pglite:devtools:prompt': () => HookResult
}

/**
 * `@nuxt/module-builder` picks this up from the module's exports and emits the
 * matching `@nuxt/schema` augmentation into `dist/types.d.mts`.
 */
export interface ModuleRuntimeConfig {
  pglite: {
    /** Connection URL of the development socket, when it is running. */
    url: string
    /** Overrides the configured data directory; set through `NUXT_PGLITE_DATA_DIR`. */
    dataDir: string
  }
}
