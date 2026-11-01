import { fileURLToPath } from 'node:url'

import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { Client } from 'pg'
import { describe, expect, inject, it } from 'vitest'

const visit = (id: number) => ({ id, createdAt: expect.any(String) })

describe('/api/visits', async () => {
  const { env, url } = inject('pglite')

  await setup({
    rootDir: fileURLToPath(new URL('..', import.meta.url)),
    server: true,
    // `@nuxt/test-utils` starts the build with `node .output/server/index.mjs`,
    // which a Workers bundle is not. On Node, `cloudflare:workers` stays an
    // unresolvable import, which `useDB` probes for.
    nuxtConfig: { nitro: { preset: 'node-server', builtinModules: ['cloudflare:workers'] } },
    // The database of the run, handed to the built app's process.
    env,
  })

  it('starts with no visits', async () => {
    expect(await $fetch('/api/visits')).toEqual({ total: 0, latest: [] })
  })

  it('records a visit per POST', async () => {
    expect(await $fetch('/api/visits', { method: 'POST' })).toEqual(visit(1))
    expect(await $fetch('/api/visits', { method: 'POST' })).toEqual(visit(2))
  })

  it('lists the recorded visits, latest first', async () => {
    expect(await $fetch('/api/visits')).toEqual({ total: 2, latest: [visit(2), visit(1)] })
  })

  it('wrote them to the database of the run', async () => {
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      const { rows } = await client.query('SELECT count(*)::int AS total FROM visits')
      expect(rows).toEqual([{ total: 2 }])
    } finally {
      await client.end()
    }
  })
})
