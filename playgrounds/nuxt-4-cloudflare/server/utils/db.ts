import { drizzle } from 'drizzle-orm/node-postgres'
import type { RequestEvent } from 'nuxt/server'
import { Client, Pool } from 'pg'

import { relations } from '../database/relations'
import * as schema from '../database/schema'

function connect(client: Client | Pool) {
  return drizzle({ client, relations })
}

export type DB = ReturnType<typeof connect>

declare module 'nuxt/schema' {
  interface RequestEventContext {
    db?: Promise<DB>
  }
}

let pool: DB | undefined
let env: Promise<Partial<Cloudflare.Env> | undefined> | undefined

/**
 * A client for this request only: Workers refuse a socket opened by another
 * request, and Hyperdrive pools the connections to the database. Workers
 * close the socket once the request is over.
 */
async function connectRequest() {
  // `cloudflare:workers` is a builtin on Workers and unresolvable on Node,
  // where a `node-server` build reads `DATABASE_URL` instead.
  env ??= import('cloudflare:workers').then(
    (m) => m.env,
    () => undefined,
  )
  const url = (await env)?.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error('No database: neither a HYPERDRIVE binding nor DATABASE_URL is set.')
  }
  const client = new Client({ connectionString: url })
  await client.connect()
  return connect(client)
}

/**
 * Drizzle over a pool on `DATABASE_URL` in development (the socket's, unless
 * already set), and over a client per request, cached on the event, in production.
 */
export async function useDB(event: Pick<RequestEvent, 'context'>): Promise<DB> {
  if (import.meta.dev) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error('No database: DATABASE_URL is not set.')
    }
    return (pool ??= connect(new Pool({ connectionString: url })))
  }
  return (event.context.db ??= connectRequest())
}

export const tables = schema
