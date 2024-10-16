import type { PGliteWorkerOptions } from '@electric-sql/pglite/worker'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { defu } from 'defu'

import {
  type Ref,
  shallowRef,
  triggerRef,
  computed,
  onBeforeUnmount,
  useRuntimeConfig,
} from '#imports'

export function usePGliteWorker(options?: PGliteWorkerOptions) {
  const { pglite: { autoImport, ...pglite } } = useRuntimeConfig().public
  const _options = defu(options, pglite)
  const pg = shallowRef<PGliteWorker | undefined>()

  if (import.meta.client) {
    pg.value = new PGliteWorker(
      new Worker(new URL('../worker/pglite.js', import.meta.url), { type: 'module' }),
      _options,
    )
  }

  onBeforeUnmount(async () => {
    if (!pg.value) return
    await pg.value.close()
    triggerRef(pg)
  })

  function _requirePGlite(pg: Ref<PGliteWorker | undefined>): pg is Ref<PGliteWorker> {
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
