import { PGliteWorker as _PGliteWorker } from '@electric-sql/pglite/worker'
import type { PGliteOptions } from '@electric-sql/pglite'
import { PGlite as _PGlite } from '@electric-sql/pglite'
import type { HookResult } from '@nuxt/schema'
import { createHooks } from 'hookable'

import type {
  PGlite,
  PGliteServerOptions,
  PGliteWorker,
  PGliteWorkerOptions,
} from './types'

export type * from './types/utils'

export interface PGliteServerHooks {
  /**
   * Called before creating a PGlite instance
   */
  'pglite:config': (options: PGliteOptions) => void
  /**
   * Called after creating a PGlite instance
   */
  'pglite': (pg: PGlite<PGliteServerOptions>) => HookResult // TODO: add server extensions
}

export const pgliteHooks = createHooks<PGliteServerHooks>()

export function pgliteCreate<O extends PGliteOptions>(options?: O): PGlite<O> {
  return new _PGlite(options) as any
}
export function pgliteWorkerCreate<O extends PGliteWorkerOptions>(options?: O): PGliteWorker<O> {
  return new _PGliteWorker(
    new Worker(new URL('./app/worker/pglite.js?worker', import.meta.url), {
      name: 'pglite-worker',
      type: 'module',
    }),
    options,
  ) as any
}
