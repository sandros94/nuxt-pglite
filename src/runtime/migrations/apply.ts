import { readFile } from 'node:fs/promises'

import { MigrationDriftError, MigrationError } from './errors'
import type { MigrationDrift } from './errors'
import type { MigrationExecutor } from './executor'
import { digestMigration, readMigrations } from './files'
import type { MigrationFile } from './files'

export interface MigrationLogger {
  info(message: string): void
  warn(message: string): void
}

export interface ApplyMigrationsOptions {
  /**
   * Table recording the applied migrations, `schema.table` or `table`. The
   * default is the one Netlify Database applies its migrations with.
   * @default 'netlify.migrations'
   */
  table?: string

  /**
   * Table recording each applied migration's digest, to detect files edited
   * or removed after they were applied; `false` disables the check.
   * @default 'nuxt_pglite.migration_digest'
   */
  digests?: boolean | string

  /**
   * Applies the migrations up to and including this one: its full name, or
   * the part before an `_` (e.g. a drizzle-kit timestamp).
   */
  target?: string

  /** Receives what was applied. Silent by default. */
  logger?: MigrationLogger
}

const DEFAULT_TABLE = 'netlify.migrations'
const DEFAULT_DIGEST_TABLE = 'nuxt_pglite.migration_digest'

// Lowercase only: quoting keeps the name exactly as given, so a mixed-case one
// would name another table than the same text written unquoted in SQL.
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/

const SILENT: MigrationLogger = { info: () => {}, warn: () => {} }

// Serialises appliers on the same database (two dev processes, a CI job and a
// deploy, …), whatever their tables: the first 8 bytes of
// sha256('nuxt-pglite:migrations'), as a signed bigint. Taken per transaction,
// so it is released with it, and reentrant within PGlite's single session.
const LOCK = `SELECT pg_advisory_xact_lock(5111100116632684462)`

interface Table {
  schema?: string
  /** The quoted, possibly qualified name. */
  sql: string
}

/**
 * Applies the migrations in `dir` not applied yet, in order, each in its own
 * transaction together with its tracking row, as Netlify Database does at
 * deploy time: a database brought up to the same files locally ends up with
 * the same schema and the same bookkeeping. Resolves with the names applied.
 *
 * Before anything runs, the applied migrations are checked against their
 * files: one edited or removed since throws a {@link MigrationDriftError}. A
 * failing migration throws a {@link MigrationError}, the ones after it do not
 * run.
 */
export async function applyMigrations(
  executor: MigrationExecutor,
  dir: string,
  options: ApplyMigrationsOptions = {},
): Promise<string[]> {
  const { digests = true, logger = SILENT, target } = options
  const tracking = parseTable(options.table ?? DEFAULT_TABLE, 'table')
  const digestTable =
    digests === false
      ? undefined
      : parseTable(digests === true ? DEFAULT_DIGEST_TABLE : digests, 'digests')

  const setup = [
    ...createTable(
      tracking,
      'name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()',
    ),
    ...(digestTable
      ? createTable(
          digestTable,
          'name TEXT PRIMARY KEY, digest TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()',
        )
      : []),
  ].join('\n')

  const [migrations] = await Promise.all([
    readMigrations(dir),
    // Under the lock: concurrent `IF NOT EXISTS` creations race on Postgres.
    executor.transaction(async (tx) => {
      await tx.exec(`${LOCK};\n${setup}`)

      if (digestTable) {
        await assertDistinctTables(tx, tracking, digestTable)
      }
    }),
  ])
  const included = upTo(migrations, target)

  const [tracked, recorded] = await Promise.all([
    executor.query<{ name: string }>(`SELECT name FROM ${tracking.sql}`),
    digestTable &&
      executor.query<{ name: string; digest: string }>(
        `SELECT name, digest FROM ${digestTable.sql}`,
      ),
  ])
  const applied = new Set(tracked.rows.map((row) => row.name))
  const pending = included.filter((name) => !applied.has(name))

  // Applied files are read only to be checked.
  const needed = migrations.filter(({ name }) =>
    applied.has(name) ? !!digestTable : pending.includes(name),
  )
  const contents = await Promise.all(needed.map(({ path }) => readFile(path, 'utf8')))
  const sql = new Map(needed.map(({ name }, i) => [name, contents[i] ?? '']))

  if (digestTable && recorded) {
    await checkDrift({
      executor,
      digestTable,
      logger,
      sql,
      applied: [...applied].toSorted((a, b) => a.localeCompare(b)),
      recorded: new Map(recorded.rows.map((row) => [row.name, row.digest])),
    })
  }

  const done: string[] = []

  for (const name of pending) {
    const text = sql.get(name) ?? ''

    try {
      // One session: the statements of a transaction run one after the other.
      const ran = await executor.transaction(async (tx) => {
        await tx.exec(LOCK)

        // Another applier may have applied it since it was read as pending.
        const { rows } = await tx.query(`SELECT 1 FROM ${tracking.sql} WHERE name = $1`, [name])

        if (rows.length > 0) {
          return false
        }

        await tx.exec(text)
        await tx.query(`INSERT INTO ${tracking.sql} (name) VALUES ($1)`, [name])

        if (digestTable) {
          // A row left by a migration since untracked by hand is replaced.
          await tx.query(
            `INSERT INTO ${digestTable.sql} (name, digest) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET digest = excluded.digest, recorded_at = now()`,
            [name, digestMigration(text)],
          )
        }

        return true
      })

      if (!ran) {
        continue
      }
    } catch (cause) {
      throw new MigrationError(name, { cause })
    }

    done.push(name)
    logger.info(`Applied migration ${name}`)
  }

  return done
}

/**
 * Compares the tables themselves, once created, rather than their spellings:
 * `public.migrations` and `migrations` may name the same one.
 */
async function assertDistinctTables(
  tx: Pick<MigrationExecutor, 'query'>,
  tracking: Table,
  digestTable: Table,
): Promise<void> {
  const { rows } = await tx.query<{ same: boolean }>(
    'SELECT to_regclass($1)::oid = to_regclass($2)::oid AS same',
    [tracking.sql, digestTable.sql],
  )

  if (rows[0]?.same) {
    throw new Error(`The digests table cannot be the tracking table (${tracking.sql}).`)
  }
}

interface DriftCheck {
  executor: MigrationExecutor
  digestTable: Table
  logger: MigrationLogger
  sql: Map<string, string>
  applied: string[]
  recorded: Map<string, string>
}

async function checkDrift({
  executor,
  digestTable,
  logger,
  sql,
  applied,
  recorded,
}: DriftCheck): Promise<void> {
  const drift: MigrationDrift[] = []
  const unrecorded: { name: string; digest: string }[] = []

  for (const name of applied) {
    const text = sql.get(name)

    if (text === undefined) {
      drift.push({ name, reason: 'removed' })
      continue
    }

    const digest = digestMigration(text)
    const previous = recorded.get(name)

    if (previous === undefined) {
      unrecorded.push({ name, digest })
    } else if (previous !== digest) {
      drift.push({ name, reason: 'edited' })
    }
  }

  if (drift.length > 0) {
    throw new MigrationDriftError(drift)
  }

  if (unrecorded.length === 0) {
    return
  }

  // Applied before digests were recorded: the files are taken as they are now.
  await executor.query(
    `INSERT INTO ${digestTable.sql} (name, digest) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT (name) DO NOTHING`,
    [unrecorded.map((row) => row.name), unrecorded.map((row) => row.digest)],
  )
  logger.warn(
    `Recorded the digest of migrations applied without one, as their files are now: ${unrecorded.map((row) => row.name).join(', ')}`,
  )
}

/** The names of the migrations up to and including `target`, all without one. */
function upTo(migrations: MigrationFile[], target: string | undefined): string[] {
  const names = migrations.map(({ name }) => name)

  if (target === undefined) {
    return names
  }

  const exact = names.indexOf(target)
  const matches =
    exact === -1 ? names.flatMap((name, i) => (name.startsWith(`${target}_`) ? [i] : [])) : [exact]
  const [end] = matches

  if (end === undefined) {
    throw new Error(`Migration target ${target} matches no migration.`)
  }

  if (matches.length > 1) {
    throw new Error(
      `Migration target ${target} is ambiguous: ${matches.map((i) => names[i]).join(', ')}.`,
    )
  }

  return names.slice(0, end + 1)
}

function parseTable(value: string, option: string): Table {
  const parts = value.split('.')

  if (parts.length > 2 || !parts.every((part) => IDENTIFIER.test(part))) {
    throw new Error(
      `Invalid \`${option}\` "${value}": expected \`table\` or \`schema.table\`, each a lowercase identifier (letters, digits, underscores).`,
    )
  }

  return {
    schema: parts.length === 2 ? parts[0] : undefined,
    sql: parts.map((part) => `"${part}"`).join('.'),
  }
}

function createTable(table: Table, columns: string): string[] {
  return [
    ...(table.schema ? [`CREATE SCHEMA IF NOT EXISTS "${table.schema}";`] : []),
    `CREATE TABLE IF NOT EXISTS ${table.sql} (${columns});`,
  ]
}
