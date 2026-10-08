import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

/**
 * The fixture is a throwaway Nuxt app that registers the module straight from
 * `src/` — no build step, so `nuxt` and `e2e` tests run against the sources.
 */
const rootDir = fileURLToPath(new URL('./test/fixtures/basic', import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.{test,spec}.ts'],
          environment: 'node',
          // Creating a PGlite instance compiles its wasm: a second or so alone,
          // several while every file starts one at once.
          testTimeout: 20_000,
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/**/*.{test,spec}.ts'],
          environment: 'nuxt',
          environmentOptions: {
            nuxt: { rootDir },
          },
        },
      }),
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
    ],
  },
})
