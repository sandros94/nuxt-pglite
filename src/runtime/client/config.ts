import type { Extensions, PGliteInterfaceExtensions } from '@electric-sql/pglite'
import type { PGliteWorker, PGliteWorkerOptions } from '@electric-sql/pglite/worker'

import type { PGliteAction } from '../core/actions'
import { markConfig } from '../core/kind'
import type { EnvOverrides } from '../core/kind'

/**
 * Options for the in-browser instance, which runs inside a Web Worker shared
 * between tabs. Postgres extensions load in the worker; extensions that add a
 * JavaScript namespace to the instance (`live`, `electricSync`) load on the
 * main thread, which is how PGlite itself splits them.
 */
export interface PGliteClientConfig<
  E extends Extensions = {},
  C extends Extensions = {},
> extends Omit<PGliteWorkerOptions, 'extensions'> {
  /** Extensions loaded in the worker, next to the database. */
  extensions?: E
  /** Extensions loaded on the main thread, typed on the instance. */
  clientExtensions?: C
  /** Runs once in each tab that creates the instance, before it is handed out. */
  init?: (pg: PGliteClientInstanceFor<PGliteClientConfig<E, C>>) => void | Promise<void>
  /** Runs before the instance is closed through its provider. */
  dispose?: (pg: PGliteClientInstanceFor<PGliteClientConfig<E, C>>) => void | Promise<void>
  /** Development tooling for this instance; nothing of it runs in a build. */
  devtools?: {
    /** Operations listed in Nuxt DevTools, run on demand in the app's tab against the worker instance. */
    actions?: PGliteClientAction<C>[]
  }
}

/** What a client action receives: the instance the app's tab holds. */
export interface PGliteClientActionContext<C extends Extensions = {}> {
  pg: PGliteWorker & PGliteInterfaceExtensions<C>
}

export type PGliteClientAction<C extends Extensions = {}> = PGliteAction<
  PGliteClientActionContext<C>
>

/** The instance `PGliteWorker.create()` returns for the given config. */
export type PGliteClientInstanceFor<C extends PGliteClientConfig<Extensions, Extensions>> =
  PGliteWorker & PGliteInterfaceExtensions<C['clientExtensions']>

export function definePGliteClientConfig<E extends Extensions = {}, C extends Extensions = {}>(
  config: PGliteClientConfig<E, C> & EnvOverrides<PGliteClientConfig<E, C>>,
): PGliteClientConfig<E, C> & EnvOverrides<PGliteClientConfig<E, C>> {
  return markConfig(config, 'client')
}
