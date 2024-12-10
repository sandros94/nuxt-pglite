import type { Extensions, PGlite, PGliteOptions, PGliteInterfaceExtensions } from '@electric-sql/pglite'
import type { PGliteWorker, PGliteWorkerOptions } from '@electric-sql/pglite/worker'
import type { HookResult } from '@nuxt/schema'
import { createHooks } from 'hookable'

export interface PGliteClientExtensions extends Extensions {
}
export interface PGliteServerExtensions extends Extensions {
}

export interface PGliteClientOptions<
  E extends PGliteClientExtensions = PGliteClientExtensions,
> extends PGliteWorkerOptions {
  extensions?: E
}
export interface PGliteServerOptions<
  E extends PGliteServerExtensions = PGliteServerExtensions,
> extends PGliteOptions {
  extensions?: E
}

export type PGliteClient<
  E extends PGliteClientOptions['extensions'] = PGliteClientOptions['extensions'],
> = PGliteWorker & PGliteInterfaceExtensions<E>
export type PGliteServer<
  E extends PGliteServerOptions['extensions'] = PGliteServerOptions['extensions'],
> = PGlite & PGliteInterfaceExtensions<E>

export interface PGliteClientHooks {
  'pglite:config': (options: PGliteClientOptions) => void
  'pglite': <
    E extends PGliteClientOptions['extensions'] = PGliteClientOptions['extensions'],
  >(pg: PGliteClient<E>) => HookResult
}
export interface PGliteServerHooks {
  /**
   * Called before creating a PGlite instance
   */
  'pglite:config': (options: PGliteServerOptions) => void
  /**
   * Called after creating a PGlite instance
   */
  'pglite': <
    E extends PGliteServerOptions['extensions'] = PGliteServerOptions['extensions'],
  >(pg: PGliteServer<E>) => HookResult
}

export const pgliteHooks = createHooks<PGliteServerHooks>()

export function isReady<T extends (PGliteClient | PGliteServer)>(pg: T | undefined): pg is T {
  return Boolean(pg?.ready)
}
