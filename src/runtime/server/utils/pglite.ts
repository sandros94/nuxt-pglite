import { createDatabase } from 'db0'
import _pglite from 'db0/connectors/pglite'

import type { PGlite, PGliteOptions, PGliteServerOptions } from '#pglite-utils'
import { useRuntimeConfig, useNitroApp } from '#imports'

// @ts-ignore Nitro virtual fs
import { extensions } from '#pglite/server-extensions.js'

let pglite: PGlite<PGliteServerOptions> | undefined
export async function usePGlite() {
  const nitroHooks = useNitroApp().hooks
  const options: PGliteServerOptions = {
    ...useRuntimeConfig().pglite,
    fs: undefined,
    extensions,
  }

  if (!pglite || pglite.closed) {
    await nitroHooks.callHookParallel('pglite:config', options)

    pglite = await createDatabase(_pglite(options)).getInstance()
  }

  await nitroHooks.callHookParallel('pglite', pglite)

  return pglite
}

export type PGliteServerInstance = PGlite<PGliteServerOptions>

export interface PGliteServerHooks {
  /**
   * Called before creating a PGlite instance
   */
  'pglite:config': (options: PGliteOptions) => void | Promise<void>
  /**
   * Called after creating a PGlite instance
   */
  'pglite': (pg: PGliteServerInstance) => void | Promise<void>
}

declare module 'nitropack/types' {
  interface NitroRuntimeHooks extends PGliteServerHooks {}
}
