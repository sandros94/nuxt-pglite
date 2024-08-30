import type { PGliteWorkerOptions } from '@electric-sql/pglite/worker'
import type { QueryOptions } from '@electric-sql/pglite'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { live } from '@electric-sql/pglite/live'
import { defu } from 'defu'

import {
  type Ref,
  ref,
  shallowRef,
  triggerRef,
  computed,
  nextTick,
  onNuxtReady,
  onBeforeUnmount,
  useRuntimeConfig,
} from '#imports'

export function usePGlite(options?: PGliteWorkerOptions) {
  const { pglite } = useRuntimeConfig().public
  const _options = defu(options, pglite, { extensions: { live } })

  const pg = shallowRef<PGliteWorker | undefined>()
  const irRightContext = ref(false)

  async function init() {
    if (!irRightContext.value) return undefined
    pg.value = await PGliteWorker.create(
      new Worker(new URL('../worker/pglite.js', import.meta.url), { type: 'module' }),
      _options,
    )
    await nextTick()
    return pg.value
  }

  onNuxtReady(async () => {
    irRightContext.value = true
    await init()
  })

  onBeforeUnmount(async () => {
    if (!pg.value) return
    await pg.value.close()
  })

  async function query<T>(query: string, params?: any[], options?: QueryOptions) {
    await init()
    const res = await pg.value?.query<T>(query, params, options)
    triggerRef(pg)
    return res
  }

  function requirePGlite(pg: Ref<PGliteWorker | undefined>): pg is Ref<PGliteWorker> {
    return pg.value?.ready === true
  }

  const isReady = computed(() => !!requirePGlite(pg))
  const isClosed = computed(() => !!pg.value?.closed)

  return {
    pg,
    isReady,
    isClosed,
    query,
  }
}
