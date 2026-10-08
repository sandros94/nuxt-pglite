/**
 * What applying migrations needs from a database. PGlite satisfies it as is;
 * `fromPool` adapts a `pg`-style pool.
 */
export interface MigrationExecutor {
  /** Runs a whole multi-statement SQL text, no params. */
  exec(sql: string): Promise<unknown>
  /** Runs one statement; `T` names the shape of its rows, as PGlite's `query` does. */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  /** Runs `fn` in a transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(fn: (tx: Pick<MigrationExecutor, 'exec' | 'query'>) => Promise<T>): Promise<T>
}

/** A connection checked out of a {@link PoolLike}, as `pg`'s `PoolClient`. */
export interface PoolClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
  /** Returns the connection to the pool; `true` discards it instead. */
  release(destroy?: boolean): void
}

/** A connection pool, as `pg`'s `Pool`. */
export interface PoolLike {
  connect(): Promise<PoolClientLike>
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

type Queryable = Pick<PoolLike, 'query'>

/**
 * Adapts a `pg`-style pool, e.g. to apply the migrations to a real Postgres in
 * CI. A transaction holds one connection for its length, as it must.
 */
export function fromPool(pool: PoolLike): MigrationExecutor {
  return {
    ...bind(pool),

    async transaction(fn) {
      const client = await pool.connect()
      // A connection that cannot even roll back is in an unknown state.
      let broken = false

      try {
        await client.query('BEGIN')
        const result = await fn(bind(client))
        await client.query('COMMIT')

        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {
          broken = true
        })

        throw error
      } finally {
        client.release(broken)
      }
    },
  }
}

function bind(target: Queryable): Pick<MigrationExecutor, 'exec' | 'query'> {
  return {
    // Without values `pg` uses the simple query protocol, which runs every
    // statement in the text; with them it would accept a single one.
    exec: (sql) => target.query(sql),
    // The driver returns untyped rows, the caller names their shape.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    query: async (sql, params) => (await target.query(sql, params)) as { rows: never[] },
  }
}
