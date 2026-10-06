import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import type { ConfigOptions } from '@nuxt/test-utils/playwright'

/**
 * Browser tests run against the playground — the closest thing to a real
 * consumer app, since it installs the module as a workspace dependency.
 */
export default defineConfig<ConfigOptions>({
  testDir: './test/browser',
  use: {
    nuxt: {
      rootDir: fileURLToPath(new URL('./playground', import.meta.url)),
    },
  },
})
