/**
 * Applies a folder of SQL migration files the way Netlify Database does at
 * deploy time, so a local database gets the same schema and bookkeeping, and
 * refuses to go on when applied files were edited or removed since. Depends
 * only on `node:*` built-ins: any database satisfying `MigrationExecutor`
 * (PGlite as is, `pg` pools through `fromPool`) works.
 */
export { applyMigrations } from './apply'
export type { ApplyMigrationsOptions, MigrationLogger } from './apply'
export { MigrationDriftError, MigrationError } from './errors'
export type { MigrationDrift } from './errors'
export { fromPool } from './executor'
export type { MigrationExecutor, PoolClientLike, PoolLike } from './executor'
export { readMigrations } from './files'
export type { MigrationFile } from './files'
