import type { PGliteInterface, Results } from '@electric-sql/pglite'

/**
 * A named operation the development tooling lists and runs on demand: seeding,
 * a reset, a CLI. It runs where it is defined; only its description
 * ({@link PGliteActionInfo}) and its outcome ever leave that process.
 */
export interface PGliteAction<Ctx> {
  /** Unique among the actions of the same side. */
  id: string
  label: string
  description?: string
  // Method syntax, for bivariance: an action written for a config with fewer
  // extensions still fits one with more, as `init` does.
  run(ctx: Ctx): unknown
}

/**
 * Where an action runs: next to the server instance, in the browser next to
 * the worker instance, or in the dev process next to the socket.
 */
export type PGliteActionSide = 'server' | 'client' | 'socket'

/** What the tooling knows of an action: everything but the code. */
export interface PGliteActionInfo {
  id: string
  label: string
  description?: string
  side: PGliteActionSide
}

/** The result of a run, reduced to JSON so that it crosses any boundary. */
export type PGliteActionOutcome = { ok: true; result: unknown } | { ok: false; error: string }

/** What the tooling shows of an instance's config. */
export interface PGliteInstanceInfo {
  /** Unset for PGlite's default, an in-memory database. */
  dataDir?: string
  /** Names of the configured extensions. */
  extensions: string[]
  actions: PGliteActionInfo[]
}

export interface PGliteQueryResult {
  /** The statement's command tag, e.g. `SELECT`, `INSERT`. */
  command?: string
  fields: string[]
  /** One array per row, in `fields` order. */
  rows: unknown[][]
  /** Rows returned, including those cut by the row limit. */
  rowCount: number
  affectedRows?: number
}

export type PGliteQueryOutcome =
  | { ok: true; results: PGliteQueryResult[] }
  | { ok: false; error: string }

/**
 * Describes the actions of one side, rejecting the duplicate or missing ids
 * that would make a run ambiguous.
 */
export function describeActions(
  actions: readonly PGliteAction<never>[] | undefined,
  side: PGliteActionSide,
): PGliteActionInfo[] {
  const seen = new Set<string>()
  return (actions ?? []).map(({ id, label, description }) => {
    if (typeof id !== 'string' || !id) {
      throw new Error(`[nuxt-pglite] A ${side} action has no \`id\`.`)
    }
    if (seen.has(id)) {
      throw new Error(`[nuxt-pglite] Two ${side} actions share the id "${id}".`)
    }
    seen.add(id)
    const info: PGliteActionInfo = { id, label: label || id, side }
    if (description) {
      info.description = description
    }
    return info
  })
}

export function describeInstance(
  config: {
    dataDir?: string
    extensions?: object
    clientExtensions?: object
    devtoolsActions?: readonly PGliteAction<never>[]
  },
  side: 'server' | 'client',
): PGliteInstanceInfo {
  const info: PGliteInstanceInfo = {
    extensions: [
      ...Object.keys(config.extensions ?? {}),
      ...Object.keys(config.clientExtensions ?? {}),
    ],
    actions: describeActions(config.devtoolsActions, side),
  }
  if (config.dataDir) {
    info.dataDir = config.dataDir
  }
  return info
}

/**
 * Runs the action with the given id. The context is only created once the
 * action is found, so an unknown id never starts an instance, and every
 * failure, the context's included, becomes an outcome rather than a throw.
 */
export async function runAction<Ctx>(
  actions: readonly PGliteAction<Ctx>[] | undefined,
  side: PGliteActionSide,
  id: string,
  context: () => Ctx | Promise<Ctx>,
): Promise<PGliteActionOutcome> {
  const action = actions?.find((candidate) => candidate.id === id)
  if (!action) {
    return { ok: false, error: `No ${side} action with the id "${id}".` }
  }
  try {
    return { ok: true, result: toSerializable(await action.run(await context())) }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/**
 * Runs one or more statements, as typed in a query box, and returns every
 * statement's result. Rows past `rowLimit` are counted but not returned.
 */
export async function runQuery(
  pg: () => Pick<PGliteInterface, 'exec'> | Promise<Pick<PGliteInterface, 'exec'>>,
  query: string,
  rowLimit = 500,
): Promise<PGliteQueryOutcome> {
  try {
    const results: Results[] = await (await pg()).exec(query, { rowMode: 'array' })
    return {
      ok: true,
      results: results.map((result) => {
        const summary: PGliteQueryResult = {
          fields: result.fields.map((field) => field.name),
          // Arrays as asked for; typed as objects, which PGlite returns by default.
          rows: result.rows
            .slice(0, rowLimit)
            .map((row: object) =>
              (Array.isArray(row) ? row : Object.values(row)).map((value) => toSerializable(value)),
            ),
          rowCount: result.rows.length,
        }
        if (result.command) {
          summary.command = result.command
        }
        if (result.affectedRows !== undefined) {
          summary.affectedRows = result.affectedRows
        }
        return summary
      }),
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export function errorMessage(error: unknown): string {
  // Not `instanceof`: a client action's error comes from the app's realm.
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return String(error)
}

/**
 * Reduces any value to one JSON represents faithfully: what an action returns
 * is arbitrary, and the devtools page, HTTP and the RPC channel all need data.
 */
export function toSerializable(value: unknown, ancestors = new Set<object>()): unknown {
  switch (typeof value) {
    case 'undefined':
      return null
    case 'bigint':
      return value.toString()
    case 'function':
    case 'symbol':
      return `[${typeof value}]`
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'object':
      break
    default:
      return value
  }
  if (value === null) {
    return null
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[${value.byteLength} bytes]`
  }
  if (ancestors.has(value)) {
    return '[circular]'
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value) || value instanceof Set) {
      return Array.from(value, (item: unknown) => toSerializable(item, ancestors))
    }
    if (value instanceof Map) {
      return Array.from(value, ([key, item]: [unknown, unknown]) => [
        toSerializable(key, ancestors),
        toSerializable(item, ancestors),
      ])
    }
    if (value instanceof Error) {
      return { name: value.name, message: value.message }
    }
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== 'function' && typeof item !== 'symbol') {
        result[key] = toSerializable(item, ancestors)
      }
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}
