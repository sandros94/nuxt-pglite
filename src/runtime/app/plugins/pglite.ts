import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import type { PGliteClientHooks, PGliteClientOptions, PGliteWorkerOptions } from '#pglite-utils'
import { pgliteWorkerCreate } from '#pglite-utils'
import { extensions } from '#build/pglite/extensions'

export default defineNuxtPlugin({
  parallel: true,
  enforce: 'post',
  async setup(nuxtApp) {
    const options: PGliteWorkerOptions<typeof extensions> = {
      ...useRuntimeConfig().public.pglite,
      // TODO: only pick Worker compatible extensions (currently `live` and `electricSync`)
      extensions,
    }
    const results = nuxtApp.hooks.callHookWith(hooks => hooks.map(hook => hook(options)), 'pglite:config', options)
    if (import.meta.dev && results && results.some(i => i && 'then' in i)) {
      console.error('[pglite] Error in `pglite:config` hook. Callback must be synchronous.')
    }

    const pglite = pgliteWorkerCreate<PGliteClientOptions<typeof extensions>>(options)

    nuxtApp.callHook('pglite', pglite)

    return {
      provide: {
        pglite,
      },
    }
  },
})

declare module '#app' {
  interface RuntimeNuxtHooks extends PGliteClientHooks {}
}
