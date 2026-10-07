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

import { assertConfigKind, definePGliteConfig, resolveEnvConfig } from './runtime/core'
import type { PGliteConfig } from './runtime/core'
import { definePGliteClientConfig } from './runtime/client/config'
import { createPGliteSocketServer } from './runtime/socket'
import { importedPackages } from './utils/imports'
import type { PGliteSocketServer } from './runtime/socket'
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
  if (!options.enabled) {
    return { socket, dataDir: defaults.dataDir }
  }

  // A full file path, so that any bundler resolves the generated import.
  const corePath = await resolver.resolvePath('./runtime/core')

  addServerTemplate({
    filename: CONFIG_ID,
    getContents: () =>
      [
        `import { assertConfigKind, resolveEnvConfig } from ${JSON.stringify(corePath)}`,
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

  addServerImports([
    { name: 'usePGlite', from: resolver.resolve('./runtime/server') },
    { name: 'definePGliteServerConfig', from: resolver.resolve('./runtime/server') },
  ])

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
          `declare module '${CONFIG_ID}' {`,
          `  import type { PGliteConfig, resolveEnvConfig } from '${resolver.resolve('./runtime/core')}'`,
          `  import type { SerializablePGliteOptions } from '${resolver.resolve('./types')}'`,
          `  export const defaults: SerializablePGliteOptions`,
          `  export const socketDataDir: string | undefined`,
          `  export const eager: boolean`,
          configPath
            ? `  const config: ReturnType<typeof resolveEnvConfig<typeof import('${configPath}').default>>`
            : `  const config: PGliteConfig`,
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

interface RunningSocket {
  server: PGliteSocketServer
  /** The served instance, which lives in this process. */
  db: PGlite
  /** The resolved server config the instance was created from. */
  config: PGliteConfig
  dataDir: string | undefined
}

/**
 * Serves PGlite from the Nuxt process rather than the Nitro one: it survives
 * server reloads and is reachable while the app builds or prerenders.
 */
async function startSocket(
  options: ServerOptions,
  nuxt: Nuxt,
  defaults: ServerOptions['options'],
  configPath: string | undefined,
  logger: ReturnType<typeof useLogger>,
): Promise<RunningSocket> {
  const socketOptions: SocketOptions = typeof options.socket === 'object' ? options.socket : {}
  const { env = 'DATABASE_URL', ...serverOptions } = socketOptions

  const userConfig = configPath ? await loadConfig(configPath) : {}
  const config: PGliteConfig = resolveEnvConfig({ ...defaults, ...userConfig }, nuxtEnv(nuxt))

  // Rendered by the `nuxt dev` UI when it runs, logged otherwise; the error
  // of a failed start propagates and is reported by Nuxt.
  const task = useTerminal().startTask('Starting PGlite…')
  const { db, server } = await serve(config, serverOptions, nuxt, logger).catch(
    (error: unknown) => {
      task.stop('PGlite socket could not start', 'failure')
      throw error
    },
  )

  nuxt.options.runtimeConfig.pglite.url = server.url
  if (env && !process.env[env]) {
    process.env[env] = server.url
    task.stop(`PGlite socket listening at ${server.url} (${env})`)
  } else {
    task.stop(`PGlite socket listening at ${server.url}`)
  }

  nuxt.hook('close', async () => {
    await server.close()
    await db.close()
  })

  return { server, db, config, dataDir: config.dataDir }
}

async function serve(
  config: PGliteConfig,
  serverOptions: Omit<SocketOptions, 'env'>,
  nuxt: Nuxt,
  logger: ReturnType<typeof useLogger>,
) {
  const { PGlite } = await importModule<typeof import('@electric-sql/pglite')>(
    '@electric-sql/pglite',
    {
      url: pathToFileURL(nuxt.options.rootDir + '/'),
    },
  )

  const db = await PGlite.create(config)
  await config.init?.(db)
  const server = await createPGliteSocketServer(db, {
    ...serverOptions,
    path:
      serverOptions.path && !isAbsolute(serverOptions.path)
        ? resolve(nuxt.options.rootDir, serverOptions.path)
        : serverOptions.path,
    logger: (...message: unknown[]) => logger.warn(message.map(String).join(' ')),
  }).listen()
  return { db, server }
}
