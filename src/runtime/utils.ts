import type { Extensions, PGliteOptions, PGliteInterfaceExtensions } from '@electric-sql/pglite'
import { PGliteWorker as _PGliteWorker } from '@electric-sql/pglite/worker'
import { PGlite as _PGlite } from '@electric-sql/pglite'
import type { HookResult } from '@nuxt/schema'
import { createHooks } from 'hookable'

import type {
  extensions as clientExtensions,
} from '#build/pglite/extensions'

export type { Extensions, PGliteOptions }
export type PGliteWorkerOptions<E extends Extensions = Extensions> = PGliteOptions<E> & {
  meta?: any
  id?: string
}

export type PGlite<O extends PGliteOptions = PGliteOptions> = _PGlite & PGliteInterfaceExtensions<O['extensions']>
export type PGliteWorker<O extends PGliteWorkerOptions = PGliteWorkerOptions> = _PGliteWorker & PGliteInterfaceExtensions<O['extensions']>

export interface PGliteClientExtensions extends Extensions {
}
export interface PGliteServerExtensions extends Extensions {
}

export interface PGliteClientOptions<
  E extends Extensions = Extensions,
> extends PGliteWorkerOptions {
  extensions?: E & PGliteClientExtensions
}
export interface PGliteServerOptions<
  E extends Extensions = Extensions,
> extends PGliteOptions {
  extensions?: E & PGliteServerExtensions
}

export interface PGliteClientHooks {
  /**
   * Called before creating a PGlite instance
   */
  'pglite:config': (options: PGliteWorkerOptions) => void
  /**
   * Called after creating a PGlite instance
   */
  'pglite': (pg: PGliteWorker<PGliteClientOptions<typeof clientExtensions>>) => HookResult
}
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
