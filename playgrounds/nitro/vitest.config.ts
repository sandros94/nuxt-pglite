import { nitro } from 'nitro/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Runs the test files inside the Nitro app, with `serverFetch` from `nitro`.
  // `noExternals`: under vitest, the ESM packages Nitro externalizes as
  // `file://` ids fail to load (`Cannot find module 'file:///…'`).
  plugins: [nitro({ noExternals: true })],
  test: {
    globalSetup: ['test/pglite.setup.ts'],
  },
})
