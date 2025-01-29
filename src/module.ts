import type { HookResult } from '@nuxt/schema'
import {
  addImports,
  addServerImports,
  addServerPlugin,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import { defu } from 'defu'

import { addTemplates } from './templates'
import type {
  ExtensionName,
  PGliteOptions,
  PGliteWorker,
  PGliteClientOptions,
  PGliteWorkerOptions,
} from './runtime/types'

export type * from './runtime/types'

export interface ModuleOptions {
  client?: {
    enabled?: boolean
    extensions?: ExtensionName[]
    liveQuery?: boolean
    options?: Omit<PGliteWorkerOptions, 'extensions' | 'fs'>
  }
  server?: {
    enabled?: boolean
    extensions?: ExtensionName[]
    options?: Omit<PGliteOptions, 'extensions' | 'fs'>
  }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-pglite',
    configKey: 'pglite',
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
    const { resolve } = createResolver(import.meta.url)

    nuxt.options.vite ||= {}
    nuxt.options.vite.optimizeDeps ||= {}
    nuxt.options.vite.optimizeDeps.exclude?.push('@electric-sql/pglite', '@electric-sql/pglite-sync')
    nuxt.options.vite.worker ||= {}
    nuxt.options.vite.worker.format ||= 'es'

    // Transpile runtime
    const runtimeDir = resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir)
    nuxt.options.alias['#pglite'] = resolve(runtimeDir)
    nuxt.options.alias['#pglite-utils'] = resolve(runtimeDir, 'utils')

    nuxt.options.runtimeConfig.public.pglite = defu(
      nuxt.options.runtimeConfig.public.pglite,
      options.client?.options,
    )
    const serverConfig = nuxt.options.runtimeConfig.pglite = defu(
      nuxt.options.runtimeConfig.pglite,
      options.server?.options,
    )

    // Use relative path for server directory
    if (
      serverConfig.dataDir
      && !serverConfig.dataDir?.startsWith('memory://')
      && !serverConfig.dataDir?.startsWith('file://')
    ) {
      serverConfig.dataDir = resolve(nuxt.options.serverDir, serverConfig.dataDir)
    }

    if (options.client?.enabled !== false) {
      addImports([
        {
          name: 'usePGlite',
          from: resolve(runtimeDir, 'app', 'composables', 'pglite'),
        },
      ])

      if (options.client?.liveQuery || options.client?.extensions?.includes('live')) {
        addImports([
          {
            name: 'useLiveQuery',
            from: resolve(runtimeDir, 'app', 'composables', 'live-query'),
          },
          {
            name: 'useLiveIncrementalQuery',
            from: resolve(runtimeDir, 'app', 'composables', 'live-query'),
          },
        ])
      }
    }
    if (options.server?.enabled !== false) {
      addServerImports([
        {
          name: 'usePGlite',
          from: resolve(runtimeDir, 'server', 'utils', 'pglite'),
        },
      ])
      addServerPlugin(resolve(runtimeDir, 'server', 'plugins', 'pglite'))
    }

    addTemplates(options)
  },
})

interface PGliteClientHooks {
  /**
   * Called before creating a PGlite instance
   */
  'pglite:config': (options: PGliteClientOptions) => void
  /**
   * Called after creating a PGlite instance
   */
  'pglite': (pg: PGliteWorker<PGliteClientOptions>) => HookResult
}

declare module '#app' {
  interface RuntimeNuxtHooks extends PGliteClientHooks {}
}
