import { fileURLToPath } from 'node:url'

// Relative rather than `nuxt-pglite/testing/vitest`: in this monorepo the
// module is stubbed, and its `dist` has no built files for the package
// exports to reach.
import { definePGliteGlobalSetup } from '../../../src/runtime/testing/vitest'

export default definePGliteGlobalSetup({
  // DX gap 2: a relative `config` resolves against `process.cwd()`, not the vitest root.
  config: fileURLToPath(new URL('../server/pglite.config', import.meta.url)),
})
