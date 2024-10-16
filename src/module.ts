import {
  addImports,
  addServerImports,
  addServerPlugin,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import type { PGliteOptions } from '@electric-sql/pglite'
import { defu } from 'defu'

// Module options TypeScript interface definition
export interface ModuleOptions {
  client?: PGliteOptions & { autoImport?: boolean }
  server?: PGliteOptions & { autoImport?: boolean }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-pglite',
    configKey: 'pglite',
  },
  // Default configuration options of the Nuxt module
  defaults: {
    client: {
      autoImport: true,
      debug: undefined,
      dataDir: 'memory://nuxt-pglite',
    },
    server: {
      autoImport: true,
      debug: undefined,
      dataDir: 'memory://nuxt-pglite',
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
      options.client,
    )
    const serverConfig = nuxt.options.runtimeConfig.pglite = defu(
      nuxt.options.runtimeConfig.pglite,
      options.server,
    )

    // Use relative path for server directory
    if (!serverConfig.dataDir.startsWith('memory://') && !serverConfig.dataDir.startsWith('file://')) {
      serverConfig.dataDir = resolve(nuxt.options.serverDir, serverConfig.dataDir)
    }

    if (nuxt.options.runtimeConfig.public.pglite.autoImport) {
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
    if (nuxt.options.runtimeConfig.pglite.autoImport) {
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
