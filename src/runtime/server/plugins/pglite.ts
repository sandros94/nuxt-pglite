import { consola } from 'consola'

import { defineNitroPlugin, usePGlite } from '#imports'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hookOnce('close', async () => {
    const pg = usePGlite()

    if (pg) {
      consola.log('`Nitro`: closing PGlite...')
      await pg.close()

      if (pg.closed) {
        consola.success('`Nitro`: PGlite closed!')
      }
    }
    else consola.log('`Nitro`: no PGlite instance found. Nitro Shuting down.')
  })
})
