import type { PGlite, PGliteServerOptions } from '#pglite-utils'
import { pgliteHooks, pgliteCreate } from '#pglite-utils'
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
    await pgliteHooks.callHookParallel('pglite:config', options)

    pglite = await pgliteCreate<PGliteServerOptions<typeof options.extensions>>(options)
  }

  pgliteHooks.callHook('pglite', pglite)
  return pglite
}
