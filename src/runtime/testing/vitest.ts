import type { Extensions } from '@electric-sql/pglite'
// Types only: nothing of vitest is loaded at runtime.
import type { TestProject } from 'vitest/node'

import { createTestDatabase } from './database'
import type { TestDatabaseOptions, TestSocketOptions } from './database'

declare module 'vitest' {
  interface ProvidedContext {
    /** The database `definePGliteGlobalSetup` serves for the run: `inject('pglite')`. */
    pglite: { url: string; env: Record<string, string> }
  }
}

export interface PGliteGlobalSetupOptions<E extends Extensions = {}> extends Omit<
  TestDatabaseOptions<E>,
  'socket'
> {
  /**
   * The test files run in workers, which reach the database through the
   * socket only, so it cannot be turned off.
   * @default true
   */
  socket?: true | TestSocketOptions
}

/**
 * A vitest `globalSetup` module: one database for the run, created before
 * the workers start, served over the socket and torn down once the run ends.
 * Its variables are exported (unless `exportEnv: false`) before the workers
 * are spawned, so they inherit them; it is also provided as `pglite`.
 *
 * ```ts
 * // test/pglite.setup.ts, listed in `test.globalSetup`
 * export default definePGliteGlobalSetup({ config: 'server/pglite.config' })
 * ```
 */
export function definePGliteGlobalSetup<E extends Extensions = {}>(
  options: PGliteGlobalSetupOptions<E> = {},
): (project: Pick<TestProject, 'provide'>) => Promise<() => Promise<void>> {
  return async (project) => {
    const db = await createTestDatabase<E>({ ...options, socket: options.socket ?? true })
    // Served, so `url` is set.
    project.provide('pglite', { url: db.url!, env: db.env })
    return () => db.close()
  }
}
