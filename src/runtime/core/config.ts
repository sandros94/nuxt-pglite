import type {
  Extensions,
  PGlite,
  PGliteInterfaceExtensions,
  PGliteOptions,
} from '@electric-sql/pglite'

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
  init?: (pg: PGliteInstanceFor<PGliteConfig<E>>) => void | Promise<void>

  /**
   * Runs before the instance is closed through its provider, e.g. on server
   * shutdown: the place to flush or checkpoint.
   */
  dispose?: (pg: PGliteInstanceFor<PGliteConfig<E>>) => void | Promise<void>
}

/** The instance `PGlite.create()` returns for the given options. */
export type PGliteInstanceFor<O extends PGliteOptions> = PGlite &
  PGliteInterfaceExtensions<O['extensions']>

/**
 * Identity helper that infers the extensions, so that they are typed on the
 * instance without an explicit generic.
 */
export function definePGliteConfig<E extends Extensions = {}>(
  config: PGliteConfig<E>,
): PGliteConfig<E> {
  return config
}
