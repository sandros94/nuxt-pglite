import { createResolver, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

import { setupClient } from './client'
import { setupServer } from './server'
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
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    const runtimeDir = resolver.resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir)
    // One alias per entry, for app code and for modules building on this one.
    for (const entry of ['core', 'socket', 'server', 'client']) {
      nuxt.options.alias[`#pglite/${entry}`] = resolver.resolve(runtimeDir, entry)
    }
    // A disabled side keeps its alias, pointing at a stub with the same names.
    for (const side of ['server', 'client'] as const) {
      if (!options[side].enabled) {
        nuxt.options.alias[`#pglite/${side}`] = resolver.resolve(runtimeDir, side, 'disabled')
      }
    }

    await setupServer(options.server, nuxt, resolver)
    await setupClient(options.client, nuxt, resolver)
  },
})

export default module
