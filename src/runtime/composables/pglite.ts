import type { PGliteOptions } from '@electric-sql/pglite'
import { PGlite } from '@electric-sql/pglite'
import { defu } from 'defu'

import {
  type Ref,
  shallowRef,
  triggerRef,
  computed,
  onBeforeUnmount,
  useRuntimeConfig,
} from '#imports'

export function usePGlite(options?: PGliteOptions) {
  const _options = defu(options, useRuntimeConfig().public.pglite)
  const pg = shallowRef<PGlite>()

  if (import.meta.client) {
    pg.value = new PGlite(_options)
  }

  onBeforeUnmount(async () => {
    if (!pg.value) return
    await pg.value.close()
    triggerRef(pg)
  })

  function _requirePGlite(pg: Ref<PGlite | undefined>): pg is Ref<PGlite> {
    return pg.value?.ready === true
  }
  const isReady = computed(() => !!_requirePGlite(pg))
  const isClosed = computed(() => !!pg.value?.closed)

  return {
    pg,
    isReady,
    isClosed,
  }
}
