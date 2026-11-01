import { defineConfig } from 'nitro'

import pgliteSocket from './modules/pglite-socket'

export default defineConfig({
  serverDir: './server',
  // Provided by the Workers runtime; `useDB` probes it on every target.
  builtinModules: ['cloudflare:workers'],
  modules: [pgliteSocket],
})
