import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'

/**
 * One `setup()` per file: each call builds and boots the fixture, so grouping
 * the assertions keeps the suite from paying that cost twice.
 */
describe('e2e: module against the basic fixture', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/basic', import.meta.url)),
    // Workaround: on Nuxt 4 (Nitro 2) the test build rewrites the fixture's
    // `.nuxt/tsconfig.server.json` with paths into its temporary build
    // directory, breaking type-aware linting once that directory is removed.
    nuxtConfig: { nitro: { typescript: { generateTsConfig: false } } },
  })

  it('renders the index page', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('<div>basic</div>')
  })

  it('queries the server PGlite instance with a configured extension', async () => {
    expect(await $fetch('/api/query')).toEqual({ sum: 2, ci: true })
  })
})
