import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup, useTestContext } from '@nuxt/test-utils/e2e'

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
    // Spread so that Nitro 3, which has no such option, still type-checks.
    nuxtConfig: { nitro: { typescript: { generateTsConfig: false } } },
  })

  it('renders the index page', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('<div>basic</div>')
  })

  it('queries the server PGlite instance with a configured extension', async () => {
    // Typed explicitly: the route is the fixture's, unknown here, and resolving
    // it through Nitro 3's route types can exceed TypeScript's depth limit
    // depending on unrelated declarations in the program.
    expect(await $fetch<unknown>('/api/query')).toEqual({ sum: 2, ci: true })
  })

  it('ships no PGlite in the client bundle while the client side is disabled', async () => {
    // test-utils builds into a temporary build directory and outputs under it.
    const assets = join(useTestContext().nuxt!.options.buildDir, 'output/public/_nuxt')
    const scripts = (await readdir(assets)).filter((file) => file.endsWith('.js'))
    expect(scripts.length).toBeGreaterThan(0)
    for (const file of scripts) {
      expect(await readFile(`${assets}/${file}`, 'utf8')).not.toMatch(/PGliteWorker|electric-sql/)
    }
  })
})
