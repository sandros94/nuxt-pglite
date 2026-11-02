import { defineConfig } from 'nitro'

import pgliteSocket from './modules/pglite-socket'

export default defineConfig({
  serverDir: './server',
  modules: [pgliteSocket],
})
