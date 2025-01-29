import type { HookResult } from '@nuxt/schema'
import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import type { PGliteClientOptions, PGliteWorker, PGliteWorkerOptions } from '#pglite-utils'
import { pgliteWorkerCreate } from '#pglite-utils'
import { extensions } from '#build/pglite/extensions'

export default defineNuxtPlugin({
  parallel: true,
  enforce: 'post',
  setup(nuxtApp) {
    const options: PGliteClientOptions = {
      ...useRuntimeConfig().public.pglite,
      extensions,
    }
    const results = nuxtApp.hooks.callHookWith(hooks => hooks.map(hook => hook(options)), 'pglite:config', options)
    if (import.meta.dev && results && results.some(i => i && 'then' in i)) {
      console.error('[pglite] Error in `pglite:config` hook. Callback must be synchronous.')
    }

    const { live, electric } = options.extensions || {}

    const pglite = pgliteWorkerCreate<PGliteClientOptions>({
      ...options,
      extensions: {
        ...(live?.setup !== undefined ? { live } : {}),
        ...(electric?.setup !== undefined ? { electric } : {}),
      },
    })

    nuxtApp.callHook('pglite', pglite)

    return {
      provide: {
        pglite,
      },
    }
  },
})

export type PGliteInstance = PGliteWorker<PGliteClientOptions>

export interface PGliteClientHooks {
  /**
   * Called before creating a PGlite instance
   */
  'pglite:config': (options: PGliteWorkerOptions<typeof extensions>) => void
  /**
   * Called after creating a PGlite instance
   */
  'pglite': (pg: PGliteInstance) => HookResult
}

declare module '#app' {
  interface RuntimeNuxtHooks extends PGliteClientHooks {}
  interface NuxtApp {
    $pglite: PGliteInstance
  }
}
