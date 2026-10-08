import { PGlite } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  describeActions,
  describeInstance,
  runAction,
  runQuery,
  toSerializable,
} from '../../../src/runtime/core/actions'
import type { PGliteAction } from '../../../src/runtime/core/actions'
import { definePGliteConfig } from '../../../src/runtime/core'
import type { PGliteServerAction } from '../../../src/runtime/core'
import { definePGliteClientConfig } from '../../../src/runtime/client/config'
import type { ModuleOptions } from '../../../src/types'

const noop = () => {}

describe('describeActions', () => {
  it('keeps only what crosses a process boundary', () => {
    const run = vi.fn<() => void>()
    const described = describeActions(
      [
        { id: 'seed', label: 'Seed', description: 'Inserts fixtures', run },
        { id: 'reset', label: '', run },
      ],
      'server',
    )
    expect(described).toEqual([
      { id: 'seed', label: 'Seed', description: 'Inserts fixtures', side: 'server' },
      { id: 'reset', label: 'reset', side: 'server' },
    ])
    expect(JSON.parse(JSON.stringify(described))).toEqual(described)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects duplicate and missing ids', () => {
    expect(() =>
      describeActions(
        [
          { id: 'a', label: 'A', run: noop },
          { id: 'a', label: 'Again', run: noop },
        ],
        'socket',
      ),
    ).toThrow('Two socket actions share the id "a"')
    expect(() => describeActions([{ id: '', label: 'A', run: noop }], 'client')).toThrow(
      'A client action has no `id`',
    )
  })

  it('accepts no actions', () => {
    expect(describeActions(undefined, 'server')).toEqual([])
  })
})

describe('describeInstance', () => {
  it('lists the extension names of both client groups', () => {
    const extension = { name: 'x', setup: async () => ({}) }
    expect(
      describeInstance(
        {
          dataDir: 'idb://app',
          extensions: { vector: extension },
          clientExtensions: { live: extension },
          actions: [{ id: 'clear', label: 'Clear', run: noop }],
        },
        'client',
      ),
    ).toEqual({
      dataDir: 'idb://app',
      extensions: ['vector', 'live'],
      actions: [{ id: 'clear', label: 'Clear', side: 'client' }],
    })
    expect(describeInstance({}, 'server')).toEqual({ extensions: [], actions: [] })
  })
})

describe('runAction', () => {
  const actions: PGliteAction<{ value: number }>[] = [
    { id: 'double', label: 'Double', run: ({ value }) => value * 2 },
    {
      id: 'fail',
      label: 'Fail',
      run: () => {
        throw new Error('nope')
      },
    },
    { id: 'big', label: 'Big', run: async () => ({ count: 3n, at: new Date(0) }) },
  ]

  it('runs the action with its context and serializes the result', async () => {
    expect(await runAction(actions, 'server', 'double', () => ({ value: 21 }))).toEqual({
      ok: true,
      result: 42,
    })
    expect(await runAction(actions, 'server', 'big', () => ({ value: 0 }))).toEqual({
      ok: true,
      result: { count: '3', at: '1970-01-01T00:00:00.000Z' },
    })
  })

  it('turns failures into outcomes', async () => {
    expect(await runAction(actions, 'server', 'fail', () => ({ value: 0 }))).toEqual({
      ok: false,
      error: 'nope',
    })
    const context = vi.fn<() => Promise<{ value: number }>>(() =>
      Promise.reject(new Error('no instance')),
    )
    expect(await runAction(actions, 'server', 'double', context)).toEqual({
      ok: false,
      error: 'no instance',
    })
  })

  it('creates no context for an unknown id', async () => {
    const context = vi.fn<() => { value: number }>(() => ({ value: 0 }))
    expect(await runAction(actions, 'client', 'missing', context)).toEqual({
      ok: false,
      error: 'No client action with the id "missing".',
    })
    expect(context).not.toHaveBeenCalled()
  })
})

describe('runQuery', () => {
  it('returns every statement, with rows as arrays and past the limit counted', async () => {
    const pg = await PGlite.create()
    try {
      const outcome = await runQuery(
        () => pg,
        `CREATE TABLE t (id int, name text);
         INSERT INTO t VALUES (1, 'a'), (2, NULL), (3, 'c');
         SELECT id, name, id AS id FROM t ORDER BY id;`,
        2,
      )
      expect(outcome).toEqual({
        ok: true,
        results: [
          { command: 'CREATE', fields: [], rows: [], rowCount: 0, affectedRows: 0 },
          { command: 'INSERT', fields: [], rows: [], rowCount: 0, affectedRows: 3 },
          {
            command: 'SELECT',
            fields: ['id', 'name', 'id'],
            rows: [
              [1, 'a', 1],
              [2, null, 2],
            ],
            rowCount: 3,
            // As PGlite reports it for a `SELECT`.
            affectedRows: 3,
          },
        ],
      })
      expect(await runQuery(() => pg, 'SELECT * FROM missing')).toEqual({
        ok: false,
        error: 'relation "missing" does not exist',
      })
    } finally {
      await pg.close()
    }
  })
})

describe('toSerializable', () => {
  it('reduces values to what JSON represents', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    const shared = { n: 1 }
    expect(
      toSerializable({
        missing: undefined,
        fn: () => {},
        big: 10n,
        nan: Number.NaN,
        bytes: new Uint8Array(4),
        set: new Set([1, 2]),
        map: new Map([['k', 1]]),
        error: new TypeError('bad'),
        circular,
        shared: [shared, shared],
      }),
    ).toEqual({
      missing: null,
      big: '10',
      nan: 'NaN',
      bytes: '[4 bytes]',
      set: [1, 2],
      map: [['k', 1]],
      error: { name: 'TypeError', message: 'bad' },
      circular: { name: 'loop', self: '[circular]' },
      shared: [{ n: 1 }, { n: 1 }],
    })
    expect(toSerializable(undefined)).toBeNull()
  })
})

describe('action types', () => {
  it('types the instance of a server action from the config extensions', () => {
    definePGliteConfig({
      extensions: { live },
      actions: [
        {
          id: 'live',
          label: 'Live',
          run: ({ pg }) => {
            expectTypeOf(pg.live).not.toBeAny()
          },
        },
      ],
    })
  })

  it('accepts an action written for fewer extensions', () => {
    const plain: PGliteServerAction = {
      id: 'now',
      label: 'Now',
      run: ({ pg }) => pg.query('SELECT now()'),
    }
    definePGliteConfig({ extensions: { live }, actions: [plain] })
    definePGliteClientConfig({
      clientExtensions: { live },
      actions: [
        {
          id: 'live',
          label: 'Live',
          run: ({ pg }) => {
            expectTypeOf(pg.live).not.toBeAny()
          },
        },
      ],
    })
  })

  it('takes socket actions next to the socket, not under devtools or the server', () => {
    const options: ModuleOptions = {
      socket: {
        port: 5433,
        actions: [
          {
            id: 'url',
            label: 'URL',
            run: ({ socketUrl }) => {
              expectTypeOf(socketUrl).toEqualTypeOf<string>()
            },
          },
        ],
      },
      devtools: true,
    }
    expectTypeOf(options.devtools).toEqualTypeOf<boolean | undefined>()
    const moved: ModuleOptions = {
      // @ts-expect-error -- the socket is an option of its own, at the root
      server: { socket: true },
      // @ts-expect-error -- `devtools` only toggles the tab
      devtools: { actions: [] },
    }
    expectTypeOf(moved).toEqualTypeOf<ModuleOptions>()
    definePGliteConfig({
      // @ts-expect-error -- actions sit at the root of the config file
      devtools: { actions: [] },
    })
  })
})
