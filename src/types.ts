import type { PGliteOptions } from '@electric-sql/pglite'
import type { PGliteWorkerOptions } from '@electric-sql/pglite/worker'

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

export interface ModuleOptions {
  server: {
    /** Registers `usePGlite()` and the server-side instance. */
    enabled: boolean
    /**
     * Path of the config file, relative to the root directory, extension
     * optional. It exports `definePGliteConfig({ ... })` and is where
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
  client: {
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
