// Relative rather than `nuxt-pglite/testing/vitest`: in this monorepo the
// module is stubbed, and its `dist` has no built files for the package
// exports to reach.
import { definePGliteGlobalSetup } from '../../../src/runtime/testing/vitest'

import config from '../server/pglite.config'

export default definePGliteGlobalSetup({ config })
