import type { HookResult } from '@nuxt/schema'
import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import type { PGliteClientOptions, PGliteWorker, PGliteWorkerOptions } from '#pglite-utils'
import { pgliteWorkerCreate } from '#pglite-utils'
import { extensions } from '#build/pglite/extensions'

export default defineNuxtPlugin({
  parallel: true,
  enforce: 'post',
  async setup(nuxtApp) {
    const options: PGliteWorkerOptions<typeof extensions> = {
      ...useRuntimeConfig().public.pglite,
      extensions,
    }
    const results = nuxtApp.hooks.callHookWith(hooks => hooks.map(hook => hook(options)), 'pglite:config', options)
    if (import.meta.dev && results && results.some(i => i && 'then' in i)) {
      console.error('[pglite] Error in `pglite:config` hook. Callback must be synchronous.')
    }

    // @ts-expect-error only extract supported extensions
    const { live, electric } = options.extensions || {}

    const pglite = pgliteWorkerCreate<PGliteClientOptions<typeof extensions>>({
      ...options,
      extensions: {
        ...(live?.setup !== undefined ? { live } : {}),
        ...(electric?.setup !== undefined ? { electric } : {}),
      },
    })

    nuxtApp.callHook('pglite', pglite as PGliteWorker<PGliteClientOptions<typeof extensions>>)

    return {
      provide: {
        pglite,
      },
    }
  },
})

export type PGliteInstance = PGliteWorker<PGliteClientOptions<typeof extensions>>

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
