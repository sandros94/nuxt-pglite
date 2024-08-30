import { defineNuxtModule, addImports, addServerImports, createResolver } from '@nuxt/kit'
import type { PGliteOptions } from '@electric-sql/pglite'
import { defu } from 'defu'

// Module options TypeScript interface definition
export interface ModuleOptions {
  client?: PGliteOptions
  server?: PGliteOptions
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-pglite',
    configKey: 'pglite',
  },
  // Default configuration options of the Nuxt module
  defaults: {
    client: {
      debug: undefined,
      dataDir: 'memory://nuxt-pglite',
    },
    server: {
      debug: undefined,
      dataDir: 'memory://nuxt-pglite',
    },
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    nuxt.options.vite ||= {}
    nuxt.options.vite.optimizeDeps ||= {}
    nuxt.options.vite.optimizeDeps.exclude?.push('@electric-sql/pglite')

    nuxt.options.runtimeConfig.public.pglite = defu(
      nuxt.options.runtimeConfig.public.pglite,
      options.client,
    )
    nuxt.options.runtimeConfig.pglite = defu(
      nuxt.options.runtimeConfig.pglite,
      options.server,
    )

    // Transpile runtime
    const runtimeDir = resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir)

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
    addServerImports([
      {
        name: 'usePGlite',
        from: resolve(runtimeDir, 'server', 'utils', 'pglite'),
      },
    ])
  },
})
