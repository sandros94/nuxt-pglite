import { defineNitroPlugin } from 'nitropack/runtime'

import { eager } from '#pglite/server-config'
import { pglite } from '../utils/pglite'

export default defineNitroPlugin((nitro) => {
  if (eager) {
    void pglite.use()
  }
  nitro.hooks.hook('close', () => pglite.close())
})
