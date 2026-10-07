import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, isAbsolute, resolve } from 'pathe'
import {
  addNitroPlugin,
  addServerImports,
  addServerTemplate,
  addTypeTemplate,
  findPath,
  importModule,
  useLogger,
} from '@nuxt/kit'
import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import defu from 'defu'

import type { PGliteConfig } from './runtime/core'
import { createPGliteSocketServer } from './runtime/socket'
import type { PGliteSocketServer } from './runtime/socket'
import type { ModuleOptions, SocketOptions } from './types'

const CONFIG_ID = '#pglite/server-config'

/** Data directories PGlite handles itself, which must not be resolved as paths. */
function isPathDataDir(dataDir: string) {
  return !/^[a-z-]+:\/\//.test(dataDir)
}

export async function setupServer(
  options: ModuleOptions['server'],
  nuxt: Nuxt,
  resolver: Resolver,
) {
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

  // Env-only overrides: empty by default, config keeps precedence unless `NUXT_PGLITE_*` is set.
  nuxt.options.runtimeConfig.pglite = defu(nuxt.options.runtimeConfig.pglite, {
    url: '',
    dataDir: '',
  })

  const socket =
    nuxt.options.dev && options.socket
      ? await startSocket(options, nuxt, defaults, configPath, logger)
      : undefined

  addServerTemplate({
    filename: CONFIG_ID,
    getContents: () =>
      [
        configPath
          ? `import userConfig from ${JSON.stringify(configPath)}`
          : `const userConfig = {}`,
        `export const defaults = ${JSON.stringify(defaults)}`,
        `export const socketDataDir = ${JSON.stringify(socket?.dataDir)}`,
        `export const eager = ${String(options.eager)}`,
        `export default { ...defaults, ...userConfig }`,
      ].join('\n'),
  })
  addTypeTemplate(
    {
      filename: 'types/nuxt-pglite-server.d.ts',
      getContents: () =>
        [
          `declare module '${CONFIG_ID}' {`,
          `  import type { PGliteConfig } from '${resolver.resolve('./runtime/core')}'`,
          `  import type { SerializablePGliteOptions } from '${resolver.resolve('./types')}'`,
          `  export const defaults: SerializablePGliteOptions`,
          `  export const socketDataDir: string | undefined`,
          `  export const eager: boolean`,
          configPath
            ? `  const config: typeof import('${configPath}').default`
            : `  const config: PGliteConfig`,
          `  export default config`,
          `}`,
        ].join('\n'),
    },
    { nitro: true, nuxt: true, node: false },
  )

  addServerImports([
    { name: 'usePGlite', from: resolver.resolve('./runtime/server') },
    { name: 'definePGliteConfig', from: resolver.resolve('./runtime/server') },
  ])

  addNitroPlugin({
    nitro2: resolver.resolve('./runtime/server/plugins/pglite.nitro2'),
    nitro3: resolver.resolve('./runtime/server/plugins/pglite.nitro3'),
  })
}

/**
 * Loads the config file outside the server bundle, where `definePGliteConfig`
 * is not auto-imported: it is provided as a global for the duration of the
 * import, so that a file written for the server works here unchanged.
 */
async function loadConfig(configPath: string): Promise<PGliteConfig> {
  const global: Record<string, unknown> = globalThis
  const provided = !('definePGliteConfig' in global)
  if (provided) {
    global.definePGliteConfig = (config: PGliteConfig) => config
  }
  try {
    const { default: config } = await importModule<{ default: PGliteConfig }>(configPath)
    return config
  } finally {
    if (provided) {
      delete global.definePGliteConfig
    }
  }
}

interface RunningSocket {
  server: PGliteSocketServer
  dataDir: string | undefined
}

/**
 * Serves PGlite from the Nuxt process rather than the Nitro one: it survives
 * server reloads and is reachable while the app builds or prerenders.
 */
async function startSocket(
  options: ModuleOptions['server'],
  nuxt: Nuxt,
  defaults: ModuleOptions['server']['options'],
  configPath: string | undefined,
  logger: ReturnType<typeof useLogger>,
): Promise<RunningSocket> {
  const socketOptions: SocketOptions = typeof options.socket === 'object' ? options.socket : {}
  const { env = 'DATABASE_URL', ...serverOptions } = socketOptions

  const userConfig = configPath ? await loadConfig(configPath) : {}
  const config: PGliteConfig = { ...defaults, ...userConfig }

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

  nuxt.options.runtimeConfig.pglite.url = server.url
  if (env && !process.env[env]) {
    process.env[env] = server.url
    logger.info(`PGlite socket listening at ${server.url} (${env})`)
  } else {
    logger.info(`PGlite socket listening at ${server.url}`)
  }

  nuxt.hook('close', async () => {
    await server.close()
    await db.close()
  })

  return { server, dataDir: config.dataDir }
}
