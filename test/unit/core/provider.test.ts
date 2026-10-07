import { PGlite } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { createPGliteProvider, definePGliteConfig } from '../../../src/runtime/core'

interface Fake {
  closed: boolean
  closeCalls: number
  close: () => Promise<void>
}

function fakeInstance(): Fake {
  const fake: Fake = {
    closed: false,
    closeCalls: 0,
    close: async () => {
      fake.closed = true
      fake.closeCalls++
    },
  }
  return fake
}

describe('createPGliteProvider with { create, init }', () => {
  it('creates the instance once and shares it between concurrent callers', async () => {
    const create = vi.fn<() => Promise<Fake>>(async () => fakeInstance())
    const provider = createPGliteProvider({ create })

    expect(provider.instance).toBeUndefined()
    const [a, b] = await Promise.all([provider.use(), provider.use()])
    expect(a).toBe(b)
    expect(await provider.use()).toBe(a)
    expect(create).toHaveBeenCalledTimes(1)
    expect(provider.instance).toBe(a)
  })

  it('runs init once per instance before handing it out', async () => {
    const order: string[] = []
    const provider = createPGliteProvider({
      create: async () => {
        order.push('create')
        return fakeInstance()
      },
      init: async () => {
        order.push('init')
      },
    })

    await Promise.all([provider.use(), provider.use()])
    await provider.use()
    expect(order).toEqual(['create', 'init'])
  })

  it('closes the instance and recreates it on the next use', async () => {
    const create = vi.fn<() => Promise<Fake>>(async () => fakeInstance())
    const provider = createPGliteProvider({ create })

    const first = await provider.use()
    await provider.close()
    expect(first.closeCalls).toBe(1)
    expect(provider.instance).toBeUndefined()

    const second = await provider.use()
    expect(second).not.toBe(first)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('replaces an instance that was closed behind its back', async () => {
    const create = vi.fn<() => Promise<Fake>>(async () => fakeInstance())
    const provider = createPGliteProvider({ create })

    const first = await provider.use()
    await first.close()
    expect(provider.instance).toBeUndefined()
    expect(await provider.use()).not.toBe(first)
  })

  it('retries after a failed creation', async () => {
    const create = vi
      .fn<() => Promise<Fake>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation(async () => fakeInstance())
    const provider = createPGliteProvider({ create })

    await expect(provider.use()).rejects.toThrow('boom')
    await expect(provider.use()).resolves.toBeDefined()
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('closes the instance when init fails and retries later', async () => {
    const instances: Fake[] = []
    const init = vi
      .fn<(pg: Fake) => Promise<void>>()
      .mockRejectedValueOnce(new Error('init failed'))
    const provider = createPGliteProvider({
      create: async () => {
        const fake = fakeInstance()
        instances.push(fake)
        return fake
      },
      init,
    })

    await expect(provider.use()).rejects.toThrow('init failed')
    expect(instances[0]?.closeCalls).toBe(1)
    expect(await provider.use()).toBe(instances[1])
  })

  it('close() waits for a creation in flight', async () => {
    const provider = createPGliteProvider({ create: async () => fakeInstance() })

    const creating = provider.use()
    await provider.close()
    expect((await creating).closed).toBe(true)
    expect(provider.instance).toBeUndefined()
  })
})

describe('createPGliteProvider with { create, init }', () => {
  it('creates a PGlite instance typed with the configured extensions', async () => {
    let disposed = false
    const config = definePGliteConfig({
      dataDir: 'memory://',
      extensions: { live },
      init: async (pg) => {
        expectTypeOf(pg).toHaveProperty('live')
        await pg.exec('CREATE TABLE t (id int)')
      },
      dispose: async (pg) => {
        disposed = !pg.closed
      },
    })
    const provider = createPGliteProvider(config)

    const pg = await provider.use()
    expectTypeOf(pg).toHaveProperty('live')
    expect(pg).toBeInstanceOf(PGlite)
    expect((await pg.query('SELECT count(*)::int AS n FROM t')).rows).toEqual([{ n: 0 }])

    await provider.close()
    expect(disposed).toBe(true)
    expect(pg.closed).toBe(true)
  })
})

describe('createPGliteProvider edge cases', () => {
  it('fails fast when use() is called from init() through an init scope', async () => {
    let active = false
    const provider = createPGliteProvider({
      create: async () => fakeInstance(),
      init: async () => {
        await provider.use()
      },
      initScope: {
        run: async <R>(fn: () => Promise<R>) => {
          active = true
          try {
            return await fn()
          } finally {
            active = false
          }
        },
        active: () => active,
      },
    })

    await expect(provider.use()).rejects.toThrow('still initialising')
  })

  it('closes the instance even when dispose throws', async () => {
    const provider = createPGliteProvider({
      create: async () => fakeInstance(),
      dispose: async () => {
        throw new Error('dispose failed')
      },
    })
    const pg = await provider.use()

    await expect(provider.close()).rejects.toThrow('dispose failed')
    expect(pg.closed).toBe(true)
    expect(provider.instance).toBeUndefined()
  })

  it('does not hand out an instance that is being closed', async () => {
    const provider = createPGliteProvider({
      create: async () => fakeInstance(),
      dispose: () => new Promise((resolve) => setTimeout(resolve, 30)),
    })
    const first = await provider.use()

    const closing = provider.close()
    const second = await provider.use()
    await closing

    expect(second).not.toBe(first)
    expect(second.closed).toBe(false)
  })
})
