import {
  addImports,
  addServerImports,
  addServerPlugin,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import type { PGliteOptions } from '@electric-sql/pglite'
import { defu } from 'defu'

export interface ModuleOptions {
  client?: {
    enabled?: boolean
    options?: PGliteOptions
  }
  server?: {
    enabled?: boolean
    options?: PGliteOptions
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
    },
    server: {
      enabled: true,
    },
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    nuxt.options.vite ||= {}
    nuxt.options.vite.optimizeDeps ||= {}
    nuxt.options.vite.optimizeDeps.exclude?.push('@electric-sql/pglite')

    // Transpile runtime
    const runtimeDir = resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir)
    nuxt.options.alias['#pglite'] = resolve(runtimeDir)

    nuxt.options.runtimeConfig.public.pglite = defu(
      nuxt.options.runtimeConfig.public.pglite,
      options.client?.options,
      {
        debug: undefined,
        dataDir: 'memory://nuxt-pglite',
      },
    )
    const serverConfig = nuxt.options.runtimeConfig.pglite = defu(
      nuxt.options.runtimeConfig.pglite,
      options.server?.options,
      {
        debug: undefined,
        dataDir: 'memory://nuxt-pglite',
      },
    )

    // Use relative path for server directory
    if (!serverConfig.dataDir.startsWith('memory://') && !serverConfig.dataDir.startsWith('file://')) {
      serverConfig.dataDir = resolve(nuxt.options.serverDir, serverConfig.dataDir)
    }

    if (options.client?.enabled !== false) {
      addImports([
        {
          name: 'usePGlite',
          from: resolve(runtimeDir, 'composables', 'pglite'),
        },
        {
          name: 'usePGliteWorker',
          from: resolve(runtimeDir, 'composables', 'pglite-worker'),
        },
      ])
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
  },
})
