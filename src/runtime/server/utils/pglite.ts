import { PGlite } from '@electric-sql/pglite'

import { useRuntimeConfig } from '#imports'
import type { PGliteServer, PGliteServerOptions } from '#pglite-utils'
import { pgliteHooks } from '#pglite-utils'

// TODO: wait for Nuxt 3.15 https://github.com/nuxt/nuxt/pull/29320#issuecomment-2529372256
// import { extensions } from '#nitro-build/pglite-extensions'

let pglite: PGliteServer | undefined
export function usePGlite() {
  const options: PGliteServerOptions = {
    ...useRuntimeConfig().pglite,
    // extensions,
  }

  if (!pglite || pglite.closed) {
    const results = pgliteHooks.callHookWith(hooks => hooks.map(hook => hook(options)), 'pglite:config', options)
    if (import.meta.dev && results && results.some(i => i && 'then' in i)) {
      console.error('[pglite] Error in `pglite:config` hook. Callback must be synchronous.')
    }

    pglite = new PGlite(options) as PGliteServer<typeof options.extensions>
  }

  pgliteHooks.callHook('pglite', pglite)
  return pglite as PGliteServer<typeof options.extensions>
}
