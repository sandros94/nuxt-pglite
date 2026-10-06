import { defineNitroPlugin } from 'nitropack/runtime'
import { usePGlite } from '../utils/pglite'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hookOnce('close', async () => {
    const pg = await usePGlite()
    await pg.close()

    if (!pg.closed) {
      console.error('[pglite] failed to close the server instance.')
    }
  })
})
