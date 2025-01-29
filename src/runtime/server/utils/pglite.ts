import { createDatabase } from 'db0'
import _pglite from 'db0/connectors/pglite'

import type { PGlite, PGliteServerOptions } from '#pglite-utils'
import { pgliteHooks } from '#pglite-utils'
import { useRuntimeConfig } from '#imports'

// @ts-ignore Nitro virtual fs
import { extensions } from '#pglite/server-extensions.js'

let pglite: PGlite<PGliteServerOptions> | undefined
export async function usePGlite() {
  const options: PGliteServerOptions = {
    ...useRuntimeConfig().pglite,
    extensions,
  }

  if (!pglite || pglite.closed) {
    console.log('init pglite')
    await pgliteHooks.callHookParallel('pglite:config', options)

    pglite = await createDatabase(_pglite(options)).getInstance() as PGlite<PGliteServerOptions<typeof options.extensions>>
  }

  pgliteHooks.callHook('pglite', pglite)
  return pglite
}
