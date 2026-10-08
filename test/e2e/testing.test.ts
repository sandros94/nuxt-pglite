import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'

import { createTestDatabase } from '../../src/runtime/testing'

const rootDir = fileURLToPath(new URL('../fixtures/testing', import.meta.url))

/**
 * The downstream flow: a test database from the app's own config, served
 * over the socket, and the app booted by `@nuxt/test-utils` with its URL.
 */
describe('e2e: an app reading DATABASE_URL against a test database', async () => {
  // Created before `setup()`, which takes the variables when called; not
  // exported, so that the app gets them from `env` alone.
  const db = await createTestDatabase({
    config: `${rootDir}/server/pglite.config.ts`,
    socket: true,
    exportEnv: false,
  })
  // Registered first, so it runs after the server is stopped.
  afterAll(() => db.close())

  await setup({
    rootDir,
    env: db.env,
    // Same workaround as the basic suite: keeps the fixture's generated
    // server tsconfig intact for type-aware linting; spread for Nitro 3.
    // oxlint-disable-next-line unicorn/no-useless-spread
    nuxtConfig: { nitro: { typescript: { ...{ generateTsConfig: false } } } },
  })

  it('reads the rows the test wrote through db.pg', async () => {
    await db.pg.query("INSERT INTO items (name) VALUES ('written by the test')")
    expect(await $fetch<unknown>('/api/items')).toEqual([{ name: 'written by the test' }])
  })
})
