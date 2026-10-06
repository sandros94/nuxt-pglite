import { describe, expect, it } from 'vitest'
import { getExtensions } from '../../src/templates'

describe('getExtensions', () => {
  it('returns undefined when no extension is requested', () => {
    expect(getExtensions()).toBeUndefined()
    expect(getExtensions([])).toBeUndefined()
  })

  it('maps extension names to their import statements', () => {
    expect(getExtensions(['live', 'pg_trgm'])).toEqual({
      imports: [
        `import { live } from '@electric-sql/pglite/live'`,
        `import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'`,
      ],
      extensions: ['live', 'pg_trgm'],
    })
  })

  it('registers electric sync under the `electric` namespace', () => {
    expect(getExtensions(['electricSync'])).toEqual({
      imports: [`import { electricSync } from '@electric-sql/pglite-sync'`],
      extensions: ['electric: electricSync()'],
    })
  })
})
