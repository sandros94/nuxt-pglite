import { createResolver, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'
import defu from 'defu'

import { setupClient } from './client'
import { setupDev } from './dev'
import { setupServer } from './server'
import type { ModuleOptions, ResolvedModuleOptions } from './types'

export type * from './types'

const DEFAULTS: ResolvedModuleOptions = {
  client: {
    enabled: false,
    config: 'app/pglite.config',
    options: {},
    eager: false,
  },
  server: {
    enabled: true,
    config: 'server/pglite.config',
    options: {},
    eager: false,
    socket: false,
  },
  devtools: {
    enabled: true,
    actions: [],
  },
}

// Annotated explicitly: without a bare `@nuxt/schema` reference in the type
// graph the emitted declaration cannot name `NuxtModule` portably (TS2883).
const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-pglite',
    configKey: 'pglite',
    compatibility: {
      nuxt: '>=4.6.0',
      nitro: '>=2.13.0',
    },
  },
  defaults: DEFAULTS,
  async setup(userOptions, nuxt) {
    const resolver = createResolver(import.meta.url)
    // Nuxt merges `defaults` in (`defu`), but types the merge shallowly.
    const options: ResolvedModuleOptions = defu(userOptions, DEFAULTS)

    const runtimeDir = resolver.resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir)
    // One alias per entry, for app code and for modules building on this one.
    for (const entry of ['core', 'socket', 'migrations', 'server', 'client']) {
      nuxt.options.alias[`#pglite/${entry}`] = resolver.resolve(runtimeDir, entry)
    }
    // A disabled side keeps its alias, pointing at a stub with the same names.
    for (const side of ['server', 'client'] as const) {
      if (!options[side].enabled) {
        nuxt.options.alias[`#pglite/${side}`] = resolver.resolve(runtimeDir, side, 'disabled')
      }
    }

    const server = await setupServer(options.server, nuxt, resolver)
    await setupClient(options.client, nuxt, resolver)

    // Imported statically: a dynamic import would split this module into a
    // shared chunk, from where `import.meta.url` no longer finds `runtime/`.
    if (nuxt.options.dev) {
      await setupDev(options, nuxt, resolver, server)
    }
  },
})

export default module
