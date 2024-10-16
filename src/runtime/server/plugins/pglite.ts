import { consola } from 'consola'

import { defineNitroPlugin, usePGlite } from '#imports'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => {
    const pg = usePGlite()

    if (pg) {
      consola.log('`Server`: closing PGlite...')
      pg.close()

      if (pg.closed) {
        consola.success('`Server`: PGlite closed!')
      }
    }
    else consola.log('`Server`: no PGlite instance found. Nitro Shuting down.')
  })
})
