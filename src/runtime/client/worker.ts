import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'

import config from '#pglite/client-config'

// The main thread sends its serializable options (`dataDir`, …); the
// extensions, which are not, come from the config both sides import.
void worker({
  init: (options) => PGlite.create({ ...options, extensions: config.extensions }),
})
