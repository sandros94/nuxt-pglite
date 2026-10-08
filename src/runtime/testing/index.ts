/**
 * Test tooling: a PGlite database matching the app's own config, shared or
 * forked per test, optionally served over the socket so that code reading
 * `DATABASE_URL` reaches it unchanged. Depends on PGlite, jiti (config files)
 * and `node:*` built-ins; the vitest helpers are in `nuxt-pglite/testing/vitest`.
 */
export { createTestDatabase } from './database'
export type { TestDatabase, TestDatabaseOptions, TestSocketOptions } from './database'
export { loadPGliteConfig } from './config'
export type { LoadPGliteConfigOptions } from './config'
