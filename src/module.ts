import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  addPlugin,
  addImports,
  addServerImports,
  addNitroPlugin,
  createResolver,
  defineNuxtModule,
  useLogger,
} from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'
import { default as defu } from 'defu'

import { addTemplates } from './templates'
import type { ModuleOptions } from './types'

export type * from './types'

// Annotated explicitly: without a bare `@nuxt/schema` reference in the type
// graph the emitted declaration cannot name `NuxtModule` portably (TS2883).
const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-pglite',
    configKey: 'pglite',
    compatibility: {
      nuxt: '>=4.6.0',
    },
  },
  defaults: {
    client: {
      enabled: true,
      liveQuery: false,
    },
    server: {
      enabled: true,
    },
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const logger = useLogger('nuxt-pglite')

    nuxt.options.vite ||= {}
    nuxt.options.vite.optimizeDeps ||= {}
    nuxt.options.vite.optimizeDeps.exclude ||= []
    nuxt.options.vite.optimizeDeps.exclude.push('@electric-sql/pglite', '@electric-sql/pglite-sync')
    nuxt.options.vite.worker ||= {}
    nuxt.options.vite.worker.format = 'es'

    // Transpile runtime
    const runtimeDir = resolver.resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir)
    nuxt.options.alias['#pglite'] = resolver.resolve(runtimeDir)
    nuxt.options.alias['#pglite-utils'] = resolver.resolve(runtimeDir, 'utils')

    nuxt.options.runtimeConfig.public.pglite = defu(
      nuxt.options.runtimeConfig.public.pglite,
      options.client?.options,
    )
    const serverConfig = (nuxt.options.runtimeConfig.pglite = defu(
      nuxt.options.runtimeConfig.pglite,
      options.server?.options,
    ))

    // Use relative path for server directory
    if (
      serverConfig.dataDir &&
      !serverConfig.dataDir?.startsWith('memory://') &&
      !serverConfig.dataDir?.startsWith('file://')
    ) {
      serverConfig.dataDir = resolver.resolve(nuxt.options.rootDir, serverConfig.dataDir)
      // Create the directory if it does not exist
      mkdirSync(dirname(serverConfig.dataDir), { recursive: true })
      logger.debug(`server data directory resolved to "${serverConfig.dataDir}"`)
    }

    if (options.client?.enabled !== false) {
      addPlugin({
        mode: 'client',
        src: resolver.resolve(runtimeDir, 'app', 'plugins', 'pglite.client'),
      })
      addImports([
        {
          name: 'usePGlite',
          from: resolver.resolve(runtimeDir, 'app', 'composables', 'pglite'),
        },
      ])

      if (options.client?.liveQuery || options.client?.extensions?.includes('live')) {
        addImports([
          {
            name: 'useLiveQuery',
            from: resolver.resolve(runtimeDir, 'app', 'composables', 'live-query'),
          },
          {
            name: 'useLiveIncrementalQuery',
            from: resolver.resolve(runtimeDir, 'app', 'composables', 'live-query'),
          },
        ])
      }
    }
    if (options.server?.enabled !== false) {
      addServerImports([
        {
          name: 'usePGlite',
          from: resolver.resolve(runtimeDir, 'server', 'utils', 'pglite'),
        },
      ])
      addNitroPlugin(resolver.resolve(runtimeDir, 'server', 'plugins', 'pglite'))
    }

    addTemplates(options)
  },
})

export default module
