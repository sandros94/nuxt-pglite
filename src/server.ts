import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, isAbsolute, relative, resolve } from 'pathe'
import {
  addNitroPlugin,
  addServerImports,
  addServerTemplate,
  addTypeTemplate,
  findPath,
  importModule,
  useLogger,
  useTerminal,
} from '@nuxt/kit'
import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import defu from 'defu'
import type { PGlite } from '@electric-sql/pglite'

import { definePGliteConfig } from './runtime/core/config'
import type { PGliteConfig } from './runtime/core/config'
import { assertConfigKind, resolveEnvConfig } from './runtime/core/kind'
import { definePGliteClientConfig } from './runtime/client/config'
import { createPGliteSocketServer } from './runtime/socket/server'
import { resolveSocketEnv } from './runtime/socket/env'
import { createInstance, resetInstance } from './instance'
import { corePathForTypes, importedPackages, withoutExtension } from './utils/imports'
import type { PGliteSocketServer } from './runtime/socket/server'
import type { ServerOptions, SocketOptions } from './types'

const CONFIG_ID = '#pglite/server-config'

/** Data directories PGlite handles itself, which must not be resolved as paths. */
function isPathDataDir(dataDir: string) {
  return !/^[a-z-]+:\/\//.test(dataDir)
}

/** What the development tooling needs from the server side. */
export interface ServerSetup {
  /** The development socket and the instance it serves, when it runs. */
  socket?: RunningSocket
  /** The `nuxt.config` data directory, resolved; the config file may override it at runtime. */
  dataDir?: string
}

export async function setupServer(
  options: ServerOptions,
  nuxt: Nuxt,
  resolver: Resolver,
): Promise<ServerSetup> {
  const logger = useLogger('nuxt-pglite')

  // A path from `nuxt.config` is resolved here, from the root directory; one
  // from the config file is read at runtime and so is relative to the working
  // directory, like Nitro's own storage.
  const defaults = { dataDir: '.data/pglite', ...options.options }
  if (isPathDataDir(defaults.dataDir)) {
    defaults.dataDir = resolve(nuxt.options.rootDir, defaults.dataDir)
    // PGlite creates the directory itself, but not its parents.
    mkdirSync(dirname(defaults.dataDir), { recursive: true })
  }

  const configPath = (await findPath(options.config, { cwd: nuxt.options.rootDir })) ?? undefined
  if (configPath) {
    // The socket's instance lives in this process, so a config change needs a restart.
    nuxt.options.watch.push(configPath)
  }
  if (configPath && !options.enabled && !options.socket) {
    logger.warn(
      `${relative(nuxt.options.rootDir, configPath)} found, but \`pglite.server\` is disabled and has no socket: it is not used.`,
    )
  }

  // Env-only overrides: empty by default, config keeps precedence unless `NUXT_PGLITE_*` is set.
  nuxt.options.runtimeConfig.pglite = defu(nuxt.options.runtimeConfig.pglite, {
    url: '',
    dataDir: '',
  })

  // The socket serves PGlite from this process, so it works as a dev-only
  // database even when the server side (`usePGlite()`, PGlite in the bundle)
  // is disabled for the build.
  const socket =
    nuxt.options.dev && options.socket
      ? await startSocket(options, nuxt, defaults, configPath, logger)
      : undefined

  addServerTypes(configPath, resolver)
  // The config file is typed with the helper even when only the socket loads
  // it, so it comes from core rather than from the (then disabled) server entry.
  // From the config file itself, not the core index: the index reaches the
  // provider and its `import('@electric-sql/pglite')`, which Nitro would trace
  // into the output even while the server side is disabled.
  addServerImports([
    {
      name: 'definePGliteConfig',
      as: 'definePGliteServerConfig',
      from: resolver.resolve('./runtime/core/config'),
    },
  ])
  if (!options.enabled) {
    return { socket, dataDir: defaults.dataDir }
  }

  // A full file path, so that any bundler resolves the generated import.
  const kindPath = await resolver.resolvePath('./runtime/core/kind')

  addServerTemplate({
    filename: CONFIG_ID,
    getContents: () =>
      [
        `import { assertConfigKind, resolveEnvConfig } from ${JSON.stringify(kindPath)}`,
        configPath
          ? `import userConfig from ${JSON.stringify(configPath)}`
          : `const userConfig = {}`,
        `export const defaults = ${JSON.stringify(defaults)}`,
        `export const socketDataDir = ${JSON.stringify(socket?.dataDir)}`,
        `export const eager = ${String(options.eager)}`,
        `assertConfigKind(userConfig, 'server', ${JSON.stringify(options.config)})`,
        `export default resolveEnvConfig({ ...defaults, ...userConfig }, ${JSON.stringify(nuxtEnv(nuxt))})`,
      ].join('\n'),
  })
  // PGlite loads its wasm and the extension bundles from files next to its
  // code, which a bundled copy no longer has. Nitro 2 keeps dependencies
  // external; Nitro 3 bundles them unless traced as whole packages.
  // oxlint-disable-next-line no-underscore-dangle -- Nuxt's own key
  if (nuxt.options._nitroMajor !== 2) {
    const nitro: { preset?: string; traceDeps?: (string | RegExp)[] } = nuxt.options.nitro
    const imported = configPath ? await importedPackages(configPath) : []
    nitro.traceDeps = [...(nitro.traceDeps ?? []), '@electric-sql/pglite*', ...imported]
  }

  addServerImports([{ name: 'usePGlite', from: resolver.resolve('./runtime/server') }])

  addNitroPlugin({
    nitro2: resolver.resolve('./runtime/server/plugins/pglite.nitro2'),
    nitro3: resolver.resolve('./runtime/server/plugins/pglite.nitro3'),
  })

  return { socket, dataDir: defaults.dataDir }
}

function nuxtEnv(nuxt: Nuxt) {
  return { dev: nuxt.options.dev, test: nuxt.options.test }
}

// Declared even while disabled, so the module's own sources type-check.
function addServerTypes(configPath: string | undefined, resolver: Resolver) {
  addTypeTemplate(
    {
      filename: 'types/nuxt-pglite-server.d.ts',
      getContents: () =>
        [
          // No import statements: inside an ambient module declaration they may
          // not name a path, but `import()` types may.
          `declare module '${CONFIG_ID}' {`,
          `  export const defaults: import('${corePathForTypes(resolver, './types')}').SerializablePGliteOptions`,
          `  export const socketDataDir: string | undefined`,
          `  export const eager: boolean`,
          configPath
            ? `  const config: ReturnType<typeof import('${corePathForTypes(resolver, './runtime/core/kind')}').resolveEnvConfig<typeof import('${withoutExtension(configPath)}').default>>`
            : `  const config: import('${corePathForTypes(resolver, './runtime/core/config')}').PGliteConfig`,
          `  export default config`,
          `}`,
        ].join('\n'),
    },
    { nitro: true, nuxt: true, node: false },
  )
}

/**
 * Loads the config file outside the server bundle, where `definePGliteServerConfig`
 * is not auto-imported: it is provided as a global for the duration of the
 * import, so that a file written for the server works here unchanged.
 */
async function loadConfig(configPath: string): Promise<PGliteConfig> {
  // Both helpers, so that a file using the wrong one reaches the kind check
  // and gets a pointer instead of a ReferenceError.
  const helpers: Record<string, unknown> = {
    definePGliteServerConfig: definePGliteConfig,
    definePGliteClientConfig,
  }
  const global: Record<string, unknown> = globalThis
  const provided = Object.keys(helpers).filter((name) => !(name in global))
  for (const name of provided) {
    global[name] = helpers[name]
  }
  try {
    const { default: config } = await importModule<{ default: PGliteConfig }>(configPath)
    return assertConfigKind(config, 'server', configPath)
  } finally {
    for (const name of provided) {
      delete global[name]
    }
  }
}

/** The built-in `process` action that recreates the socket's instance; registered in `src/dev.ts`. */
export const RESET_ACTION = { id: 'reset-database', label: 'Reset database' } as const

const REFUSAL_HINT = `Restart \`nuxt dev\` once the cause is fixed, or run the "${RESET_ACTION.label}" action (Nuxt DevTools, PGlite tab) to recreate the database from scratch.`

interface RunningSocket {
  server: PGliteSocketServer
  /** The resolved server config the instance is created from. */
  config: PGliteConfig
  dataDir: string | undefined
  /** The variables the socket exported, with their values. */
  env: Record<string, string>
  /**
   * Why the socket refuses clients: creating the instance, or its `init`,
   * failed. Cleared by a successful reset.
   */
  readonly failure: Error | undefined
  /** The served instance, which lives in this process; throws while there is none. */
  use(): PGlite
  /**
   * Closes the instance, removes its data directory and creates it again,
   * `init` included, behind the same URL. Connected clients are disconnected.
   */
  reset(): Promise<void>
}

/**
 * Serves PGlite from the Nuxt process rather than the Nitro one: it survives
 * server reloads and is reachable while the app builds or prerenders. A
 * failure to create the instance does not stop the dev server: the socket
 * comes up anyway and refuses clients with the reason, until a reset.
 */
async function startSocket(
  options: ServerOptions,
  nuxt: Nuxt,
  defaults: ServerOptions['options'],
  configPath: string | undefined,
  logger: ReturnType<typeof useLogger>,
): Promise<RunningSocket> {
  const socketOptions: SocketOptions = typeof options.socket === 'object' ? options.socket : {}
  const { env, provider, ...serverOptions } = socketOptions

  const userConfig = configPath ? await loadConfig(configPath) : {}
  const config: PGliteConfig = resolveEnvConfig({ ...defaults, ...userConfig }, nuxtEnv(nuxt))

  // Rendered by the `nuxt dev` UI when it runs, logged otherwise; the error
  // of a socket that cannot listen propagates and is reported by Nuxt.
  const task = useTerminal().startTask('Starting PGlite…')
  const { PGlite } = await importModule<typeof import('@electric-sql/pglite')>(
    '@electric-sql/pglite',
    { url: pathToFileURL(nuxt.options.rootDir + '/') },
  )

  let db: PGlite | undefined
  let failure: Error | undefined
  await createInstance(PGlite, config).then(
    (created) => {
      db = created
    },
    (error: unknown) => {
      failure = asError(error)
    },
  )

  const server = createPGliteSocketServer(db ?? null, {
    ...serverOptions,
    path:
      serverOptions.path && !isAbsolute(serverOptions.path)
        ? resolve(nuxt.options.rootDir, serverOptions.path)
        : serverOptions.path,
    logger: (...message: unknown[]) => logger.warn(message.map(String).join(' ')),
  })
  try {
    if (failure) {
      await server.refuse(failure, { hint: REFUSAL_HINT })
    }
    await server.listen()
  } catch (error) {
    task.stop('PGlite socket could not start', 'failure')
    await db?.close()
    throw error
  }

  nuxt.options.runtimeConfig.pglite.url = server.url
  const exported = exportEnv(resolveSocketEnv({ env, provider }, server.url), nuxt, logger)
  const names = Object.keys(exported)
  const listening = `PGlite socket ${failure ? 'refusing clients' : 'listening'} at ${server.url}${names.length ? ` (${names.join(', ')})` : ''}`
  if (failure) {
    task.stop(`${listening}: the instance could not be created`, 'failure')
    logger.error('PGlite could not be created; the socket refuses clients until a reset.', failure)
  } else {
    task.stop(listening)
  }

  // Resets run one at a time; shutdown waits for the one in progress.
  let resetting: Promise<void> = Promise.resolve()

  async function reset() {
    let released = false
    try {
      db = await resetInstance(PGlite, config, async () => {
        released = true
        await server.refuse(new Error('the database is being reset'))
        const previous = db
        db = undefined
        await previous?.close()
      })
      await server.serve(db)
    } catch (error) {
      // Refused before anything was released: the instance keeps serving.
      if (released) {
        failure = asError(error)
        await server.refuse(failure, { hint: REFUSAL_HINT })
      }
      throw error
    }
    failure = undefined
  }

  nuxt.hook('close', async () => {
    await resetting.catch(() => {})
    await server.close()
    await db?.close()
  })

  return {
    server,
    config,
    dataDir: config.dataDir,
    env: exported,
    get failure() {
      return failure
    },
    use() {
      if (!db) {
        throw new Error(`PGlite is not ready: ${failure?.message ?? 'the database is being reset'}`)
      }
      return db
    },
    reset() {
      const run = resetting.catch(() => {}).then(reset)
      resetting = run
      return run
    },
  }
}

/**
 * Sets each variable that is still unset, and returns those it set. Another
 * module may set the same ones afterwards, e.g. a database emulation in
 * `nitro:init`: they are checked once Nitro is set up and again once the dev
 * server listens, with a warning for each that no longer reaches the socket.
 * Those still holding the socket's values are unset on close, so that a
 * restart exports its own.
 */
function exportEnv(
  variables: Record<string, string>,
  nuxt: Nuxt,
  logger: ReturnType<typeof useLogger>,
): Record<string, string> {
  const exported: Record<string, string> = {}
  for (const [name, value] of Object.entries(variables)) {
    if (!process.env[name]) {
      process.env[name] = value
      exported[name] = value
    }
  }

  const warned = new Set<string>()
  const check = () => {
    for (const [name, value] of Object.entries(variables)) {
      if (process.env[name] === value || warned.has(name)) {
        continue
      }
      warned.add(name)
      logger.warn(
        name in exported
          ? `\`${name}\` was overwritten after nuxt-pglite set it, so code reading it does not reach the PGlite socket. If another module emulates a database, disable its emulation.`
          : `\`${name}\` was already set, so it is left as is and does not reach the PGlite socket. Unset it, or disable the database emulation that sets it, to use PGlite.`,
      )
    }
  }
  nuxt.hook('ready', check)
  nuxt.hook('listen', check)

  nuxt.hook('close', () => {
    for (const [name, value] of Object.entries(exported)) {
      if (process.env[name] === value) {
        delete process.env[name]
      }
    }
  })

  return exported
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
