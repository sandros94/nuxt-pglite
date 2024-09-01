import type { PGliteOptions, QueryOptions } from '@electric-sql/pglite'
import { PGlite } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { vector } from '@electric-sql/pglite/vector'
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

export function usePGlite(options?: PGliteOptions) {
  const { pglite } = useRuntimeConfig().public
  const _options = defu(options, pglite, { extensions: { live, vector } })

  const pg = shallowRef<PGlite | undefined>()
  const isRightContext = ref(false)

  async function init() {
    if (!isRightContext.value) return undefined
    pg.value = await PGlite.create(_options)
    await nextTick()
    return pg.value
  }

  onNuxtReady(async () => {
    isRightContext.value = true
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

  function requirePGlite(pg: Ref<PGlite | undefined>): pg is Ref<PGlite> {
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
