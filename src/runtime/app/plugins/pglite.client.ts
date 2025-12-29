import type { Extension } from '@electric-sql/pglite'
import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import type { PGliteClientOptions, PGliteWorker, PGliteWorkerOptions } from '#pglite-utils'
import { pgliteWorkerCreate } from '#pglite-utils'
import { extensions } from '#build/pglite/extensions'

export default defineNuxtPlugin({
  name: 'nuxt-pglite',
  parallel: true,
  enforce: 'post',
  env: {
    islands: false,
  },
  async setup(nuxtApp) {
    const options: PGliteWorkerOptions<typeof extensions> = {
      ...useRuntimeConfig().public.pglite,
      extensions,
    }

    await nuxtApp.hooks.callHookParallel('pglite:config', options)

    // TODO: reconsider this and allow built-time whitelisting of extensions
    // Only include extensions that are compatible with workers
    const { live, electric } = (options.extensions || {}) as {
      live?: Extension
      electric?: Extension
    }

    const pglite = await pgliteWorkerCreate<PGliteClientOptions<typeof options.extensions>>({
      ...options,
      extensions: {
        ...(live?.setup !== undefined ? { live } : {}),
        ...(electric?.setup !== undefined ? { electric } : {}),
      },
    })

    await nuxtApp.hooks.callHookParallel('pglite:init', pglite)

    return {
      provide: {
        pglite,
      },
    }
  },
})

export type PGliteClientInstance = PGliteWorker<PGliteClientOptions<typeof extensions>>

export interface PGliteClientHooks {
  /**
   * Called before creating a PGlite instance
   */
  'pglite:config': (options: PGliteWorkerOptions<typeof extensions>) => void | Promise<void>
  /**
   * Called after creating a PGlite instance
   */
  'pglite:init': (pg: PGliteClientInstance) => void | Promise<void>
}

declare module '#app' {
  interface RuntimeNuxtHooks extends PGliteClientHooks {}
  interface NuxtApp {
    $pglite: PGliteClientInstance
  }
}
