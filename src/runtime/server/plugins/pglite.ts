import { consola } from 'consola'

import { defineNitroPlugin } from 'nitropack/runtime'
import { usePGlite } from '../utils/pglite'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hookOnce('close', async () => {
    const pg = await usePGlite()

    consola.log('`Nitro`: closing PGlite...')
    await pg.close()

    if (pg.closed) {
      consola.success('`Nitro`: PGlite closed successfully.')
    }
    else {
      consola.error('`Nitro`: failed to close PGlite.')
    }
  })
})
