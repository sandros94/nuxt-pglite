import { defineNuxtModule, addServerImports, createResolver } from '@nuxt/kit'

// Module options TypeScript interface definition
export interface ModuleOptions {}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-pglite',
    configKey: 'pglite',
  },
  // Default configuration options of the Nuxt module
  defaults: {},
  setup(_options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    nuxt.options.vite ||= {}
    nuxt.options.vite.optimizeDeps ||= {}
    nuxt.options.vite.optimizeDeps.exclude?.push('@electric-sql/pglite')

    // Transpile runtime
    const runtimeDir = resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir)

    addServerImports([
      {
        name: 'usePGlite',
        from: resolve(runtimeDir, 'server', 'utils', 'pglite'),
      },
    ])
  },
})
