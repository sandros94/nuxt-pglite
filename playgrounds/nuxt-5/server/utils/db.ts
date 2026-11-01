import { drizzle } from 'drizzle-orm/node-postgres'
import type { H3Event } from 'h3'
import { onDispose } from 'h3'
import { Client } from 'pg'

import { relations } from '../database/relations'
import * as schema from '../database/schema'

let env: Promise<Partial<Cloudflare.Env> | undefined> | undefined

/**
 * The Workers bindings, resolved once per isolate: `cloudflare:workers` is
 * a builtin there and an unresolvable import anywhere else, which is the
 * probe. Only the reference is kept; values are read per request.
 */
function cloudflareEnv() {
  return (env ??= import('cloudflare:workers').then(
    (m) => m.env,
    () => undefined,
  ))
}

async function connectionString() {
  const url = (await cloudflareEnv())?.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error('No database: neither a HYPERDRIVE binding nor DATABASE_URL is set.')
  }
  return url
}

async function createDB(event: H3Event) {
  const client = new Client({ connectionString: await connectionString() })
  await client.connect()
  // `onDispose` runs once the response is over, inside the request's own
  // context (handed to `waitUntil` on Workers), so the socket is never
  // touched from another request.
  onDispose(event, () => client.end())
  return drizzle({ client, relations })
}

export type DB = Awaited<ReturnType<typeof createDB>>

declare module 'h3' {
  interface H3EventContext {
    db?: Promise<DB>
  }
}

/**
 * Drizzle over one `pg.Client` per request, cached on the event: Workers
 * forbid reusing a socket opened by another request, and Hyperdrive does the
 * pooling, so a client is created for each request and never shared.
 */
export function useDB(event: H3Event) {
  return (event.context.db ??= createDB(event))
}

export const tables = schema
