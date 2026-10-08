/** An applied migration that no longer matches its file. */
export interface MigrationDrift {
  name: string
  reason: 'edited' | 'removed'
}

/**
 * A migration that failed. Its transaction was rolled back, so neither its
 * statements nor its tracking row are in the database, and the migrations
 * after it were not run.
 */
export class MigrationError extends Error {
  /** Name of the migration that failed (`name` is the error's own). */
  readonly migration: string

  constructor(migration: string, options: { cause: unknown }) {
    const reason = options.cause instanceof Error ? options.cause.message : String(options.cause)

    super(`Migration ${migration} failed: ${reason}`, options)
    this.name = 'MigrationError'
    this.migration = migration
  }
}

/**
 * Applied migrations whose files were edited or removed since. A migration
 * runs once, so the database no longer matches the files: deployed, the same
 * files would build another schema. Thrown before any migration runs.
 */
export class MigrationDriftError extends Error {
  readonly details: MigrationDrift[]

  constructor(details: MigrationDrift[]) {
    super(
      [
        'Applied migrations no longer match their files:',
        ...details.map(({ name, reason }) => `  - ${name}: ${reason}`),
        'Applied migrations never run again: reset the local database to apply the current files.',
      ].join('\n'),
    )
    this.name = 'MigrationDriftError'
    this.details = details
  }
}
