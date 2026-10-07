/**
 * A Postgres wire-protocol server in front of a PGlite instance, so that any
 * Postgres client (drivers, migration tools, `psql`) can use PGlite as if it
 * were a running server. Depends only on PGlite and `node:*` built-ins.
 */

export { createPGliteSocketServer } from './server'
export type { PGliteSocketServer, PGliteSocketServerOptions } from './server'
export { ProtocolError } from './protocol'
