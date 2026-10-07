import type { PGliteOptions } from '@electric-sql/pglite'
import type { PGliteWorkerOptions } from '@electric-sql/pglite/worker'
import type { startSubprocess } from '@nuxt/devtools-kit'
import type { SubprocessOptions, TerminalState } from '@nuxt/devtools-kit/types'
import type { NuxtLogger, NuxtTerminal } from '@nuxt/kit'
import type { HookResult } from '@nuxt/schema'

import type { PGliteAction } from './runtime/core/actions'

export type {
  PGliteAction,
  PGliteActionInfo,
  PGliteActionSide,
  PGliteServerAction,
  PGliteServerActionContext,
} from './runtime/core'
export type { PGliteClientAction, PGliteClientActionContext } from './runtime/client/config'

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
   * Environment variable that receives the connection URL, `DATABASE_URL` by
   * default. Set only when the variable is still unset, so a real database
   * configured in the environment always wins. `false` disables it.
   */
  env?: string | false
  /** Clients allowed at once; unlimited by default. */
  maxConnections?: number
  /** Milliseconds a client may sit idle inside a transaction before it is disconnected; `0` disables it. */
  idleInTransactionTimeout?: number
}

/** What a `process` action receives: how to reach the database from outside the app. */
export interface PGliteProcessActionContext {
  /** Connection URL of the development socket, when it runs. */
  socketUrl?: string
  /**
   * Data directory of the server side: the one the socket serves while it
   * runs, the `nuxt.config` default otherwise. Unset for an in-memory database.
   */
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

export type PGliteProcessAction = PGliteAction<PGliteProcessActionContext>

export interface DevtoolsOptions {
  /** Adds the PGlite tab to Nuxt DevTools, when DevTools is enabled. */
  enabled: boolean
  /**
   * Actions that run outside the app, reaching the database through the
   * socket URL: CLIs, migrations, studios. Other modules add theirs through
   * the `pglite:devtools:actions` hook.
   */
  actions: PGliteProcessAction[]
}

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
  /**
   * Serves the development instance over the Postgres wire protocol, so
   * drivers and tools outside the app (`drizzle-kit`, `psql`, …) reach it
   * through a connection URL. Development only.
   */
  socket: boolean | SocketOptions
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
  /** Nuxt DevTools integration and `process` actions: none of it is registered outside `nuxt dev`. */
  devtools: DevtoolsOptions
}

/** What `nuxt.config` accepts: any part of it, merged over the defaults. */
export interface ModuleOptions {
  server?: Partial<ServerOptions>
  client?: Partial<ClientOptions>
  devtools?: Partial<DevtoolsOptions>
}

/**
 * Build-time hooks; `@nuxt/module-builder` emits the matching `NuxtHooks`
 * augmentation into `dist/types.d.mts`.
 */
export interface ModuleHooks {
  /**
   * Collects the `process` actions, once every module is set up: push to the
   * array. Called in development only.
   */
  'pglite:devtools:actions': (actions: PGliteProcessAction[]) => HookResult
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
