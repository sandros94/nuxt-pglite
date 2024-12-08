import { type PGliteWorkerOptions, PGliteWorker } from '@electric-sql/pglite/worker'
import type { PGliteInterfaceExtensions } from '@electric-sql/pglite'

import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import { extensions } from '#build/pglite/extensions'

type PGliteWorkerInterface<E> = PGliteWorker & PGliteInterfaceExtensions<E>

export default defineNuxtPlugin({
  env: { islands: false },
  parallel: true,
  async setup() {
    let pglite: PGliteWorkerInterface<typeof extensions> | undefined = undefined

    if (!import.meta.server) {
      pglite = await PGliteWorker.create(
        new Worker(new URL('../worker/pglite.js', import.meta.url), { type: 'module' }),
        {
          ...useRuntimeConfig().public.pglite as PGliteWorkerOptions,
          extensions,
        },
      )
    }

    return {
      provide: {
        pglite,
      },
    }
  },
})
