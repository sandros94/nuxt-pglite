import { PGlite as _PGlite } from '@electric-sql/pglite'
import { PGliteWorker as _PGliteWorker } from '@electric-sql/pglite/worker'

import type {
  PGlite,
  PGliteOptions,
  PGliteWorker,
  PGliteWorkerOptions,
} from './types'

export type * from './types/utils'

export async function pgliteCreate<O extends PGliteOptions>(options?: O): Promise<PGlite<O>> {
  return await _PGlite.create(options)
}
export async function pgliteWorkerCreate<O extends PGliteWorkerOptions>(options?: O): Promise<PGliteWorker<O>> {
  return await _PGliteWorker.create(
    new Worker(new URL('./app/worker/pglite.js?worker', import.meta.url), {
      name: 'pglite-worker',
      type: 'module',
    }),
    options,
  )
}
