import type { PGliteWorkerOptions } from '@electric-sql/pglite/worker'
import type { QueryOptions } from '@electric-sql/pglite'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { live } from '@electric-sql/pglite/live'
import { defu } from 'defu'

import { ref, shallowRef, triggerRef, watch, onNuxtReady, onBeforeUnmount, useRuntimeConfig } from '#imports'

export function usePGlite(options?: PGliteWorkerOptions) {
  const { pglite } = useRuntimeConfig().public
  const _options = defu(options, pglite, { extensions: { live } })

  const pg = shallowRef<PGliteWorker | undefined>()
  const isReady = ref(false)
  const isClosed = ref(true)

  onNuxtReady(async () => {
    pg.value = await PGliteWorker.create(
      new Worker(new URL('../worker/pglite.js', import.meta.url), { type: 'module' }),
      _options,
    )
    await pg.value.waitReady.then(() => triggerRef(pg))
  })

  onBeforeUnmount(() => {
    watchPg()
    if (!pg.value) return
    pg.value.close()
  })

  const watchPg = watch(pg, () => {
    isReady.value = !!pg.value?.ready
    isClosed.value = !!pg.value?.closed
  })

  function query<T>(query: string, params?: any[], options?: QueryOptions) {
    return pg.value?.query<T>(query, params, options)
  }

  return {
    pg,
    isReady,
    isClosed,
    query,
  }
}
