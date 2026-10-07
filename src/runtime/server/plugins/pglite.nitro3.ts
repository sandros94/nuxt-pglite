import { definePlugin } from 'nitro'

import { eager } from '#pglite/server-config'
import { pglite } from '../utils/pglite'

export default definePlugin((nitro) => {
  if (eager) {
    void pglite.use()
  }
  nitro.hooks.hook('close', () => pglite.close())
})
