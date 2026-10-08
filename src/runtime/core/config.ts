import type {
  Extensions,
  PGlite,
  PGliteInterfaceExtensions,
  PGliteOptions,
} from '@electric-sql/pglite'

import type { PGliteAction } from './actions'
import { markConfig } from './kind'
import type { EnvOverrides } from './kind'

/**
 * PGlite options plus the hook that prepares a freshly created instance. The
 * extensions generic is preserved so that they show up on the instance type,
 * as they do with `PGlite.create()`.
 */
export interface PGliteConfig<E extends Extensions = {}> extends PGliteOptions<E> {
  /**
   * Runs once per created instance, before it is handed out: the place for
   * `CREATE EXTENSION`, schema setup or seeding.
   */
  init?: (pg: PGliteInstanceFor<PGliteConfig<E>>) => unknown

  /**
   * Runs before the instance is closed through its provider, e.g. on server
   * shutdown: the place to flush or checkpoint.
   */
  dispose?: (pg: PGliteInstanceFor<PGliteConfig<E>>) => unknown

  /**
   * Actions listed in Nuxt DevTools and the terminal picker, run on demand
   * against this instance. Development tooling: nothing of it runs in a build.
   */
  devtoolsActions?: PGliteServerAction<E>[]
}

/** What a server action receives: the instance this config creates. */
export interface PGliteServerActionContext<E extends Extensions = {}> {
  pg: PGliteInstanceFor<PGliteConfig<E>>
}

export type PGliteServerAction<E extends Extensions = {}> = PGliteAction<
  PGliteServerActionContext<E>
>

/** The instance `PGlite.create()` returns for the given options. */
export type PGliteInstanceFor<O extends PGliteOptions> = PGlite &
  PGliteInterfaceExtensions<O['extensions']>

/**
 * Identity helper that infers the extensions, so that they are typed on the
 * instance without an explicit generic.
 */
export function definePGliteConfig<E extends Extensions = {}>(
  config: PGliteConfig<E> & EnvOverrides<PGliteConfig<E>>,
): PGliteConfig<E> & EnvOverrides<PGliteConfig<E>> {
  return markConfig(config, 'server')
}
