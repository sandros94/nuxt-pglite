import type { PGlite, PGliteOptions, PGliteServerOptions } from '#pglite-utils'
import { pgliteHooks, pgliteCreate } from '#pglite-utils'
import { useRuntimeConfig } from '#imports'

// TODO: wait for Nuxt 3.15 https://github.com/nuxt/nuxt/pull/29320#issuecomment-2529372256
// import { extensions } from '#nitro-build/pglite-extensions'

let pglite: PGlite<PGliteServerOptions> | undefined
export function usePGlite() {
  const options: PGliteOptions = {
    ...useRuntimeConfig().pglite,
    // extensions,
  }

  if (!pglite || pglite.closed) {
    const results = pgliteHooks.callHookWith(hooks => hooks.map(hook => hook(options)), 'pglite:config', options)
    if (import.meta.dev && results && results.some(i => i && 'then' in i)) {
      console.error('[pglite] Error in `pglite:config` hook. Callback must be synchronous.')
    }

    // @ts-expect-error `playground` types interfere with `src`
    pglite = pgliteCreate<PGliteServerOptions>(options)
  }

  pgliteHooks.callHook('pglite', pglite)
  return pglite
}
