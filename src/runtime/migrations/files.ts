import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export interface MigrationFile {
  /** The directory's name, or the file's without `.sql`. */
  name: string
  /** Absolute path of the SQL file. */
  path: string
}

/**
 * Lists the migrations in `dir` (resolved from the working directory), in the
 * order they apply. A migration is a `<name>/migration.sql` directory, the
 * layout drizzle-kit 1.0 generates, or a flat `<name>.sql` file; anything else
 * is ignored. Throws when both shapes declare the same name.
 */
export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const root = resolve(dir)
  const entries = await readdir(root, { withFileTypes: true })

  const found = await Promise.all(
    entries.map(async (entry): Promise<MigrationFile | undefined> => {
      if (entry.isDirectory()) {
        const path = join(root, entry.name, 'migration.sql')
        const file = await stat(path).catch(() => undefined)

        return file?.isFile() ? { name: entry.name, path } : undefined
      }

      if (entry.isFile() && entry.name.endsWith('.sql')) {
        return { name: entry.name.slice(0, -'.sql'.length), path: join(root, entry.name) }
      }

      return undefined
    }),
  )

  const migrations = new Map<string, MigrationFile>()

  for (const migration of found) {
    if (!migration) {
      continue
    }

    const existing = migrations.get(migration.name)

    if (existing) {
      throw new Error(
        `Migration ${migration.name} is declared twice: ${existing.path} and ${migration.path}.`,
      )
    }

    migrations.set(migration.name, migration)
  }

  // As Netlify's own dev applier (`@netlify/database-dev`) sorts them, so that
  // both apply in the same order; names are expected to start with a
  // timestamp, which sorts alike in every locale.
  return [...migrations.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}

/** Identifies a migration's content, to tell when an applied file changes. */
export function digestMigration(sql: string): string {
  return createHash('sha256').update(sql).digest('hex')
}
