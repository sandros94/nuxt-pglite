import type { PGliteWorker, PGliteClientOptions } from '#pglite-utils'
import { pgliteWorkerCreate } from '#pglite-utils'
import {
  createError,
  useNuxtApp,
  useRuntimeConfig,
} from '#imports'

import { extensions } from '#build/pglite/extensions'

let pglite: PGliteWorker<PGliteClientOptions> | undefined
export async function usePGlite() {
  const nuxtApp = useNuxtApp()

  if (import.meta.server) throw createError({
    statusCode: 500,
    statusMessage: 'Client-side only',
    message: '[pglite] `usePGlite()` composable should only be called client-side',
  })
  else if (!pglite || pglite.closed) {
    const options: PGliteClientOptions = {
      ...useRuntimeConfig().public.pglite,
      extensions,
    }

    await nuxtApp.hooks.callHookParallel('pglite:config', options)

    const { live, electric } = options.extensions || {}

    pglite = pgliteWorkerCreate<PGliteClientOptions<typeof options.extensions>>({
      ...options,
      extensions: {
        ...(live?.setup !== undefined ? { live } : {}),
        ...(electric?.setup !== undefined ? { electric } : {}),
      },
    })
  }

  nuxtApp.hooks.callHookParallel('pglite', pglite)
  return pglite
}
