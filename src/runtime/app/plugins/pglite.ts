import { PGliteWorker } from '@electric-sql/pglite/worker'

import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import type { PGliteClientHooks, PGliteClientOptions } from '#pglite-utils'
import { extensions } from '#build/pglite/extensions'

export default defineNuxtPlugin({
  parallel: true,
  enforce: 'post',
  async setup(nuxtApp) {
    const options: PGliteClientOptions = {
      ...useRuntimeConfig().public.pglite,
      extensions,
    }
    const results = nuxtApp.hooks.callHookWith(hooks => hooks.map(hook => hook(options)), 'pglite:config', options)
    if (import.meta.dev && results && results.some(i => i && 'then' in i)) {
      console.error('[pglite] Error in `pglite:config` hook. Callback must be synchronous.')
    }

    const pglite = await PGliteWorker.create(
      new Worker(new URL('../worker/pglite.js?worker', import.meta.url), {
        name: 'pglite-worker',
        type: 'module',
      }),
      options,
    )

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
