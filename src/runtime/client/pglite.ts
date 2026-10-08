import { PGliteWorker } from '@electric-sql/pglite/worker'
import { createError } from '#imports'

import { createPGliteProvider } from '../core/provider'
import type { PGliteProvider } from '../core/provider'
import type { PGliteClientInstanceFor } from './config'
import config from '#pglite/client-config'

type Instance = PGliteClientInstanceFor<typeof config>

function createProvider(): PGliteProvider<Instance> {
  // The worker loads `extensions` itself from the same config; the rest of
  // what is not options holds functions, which cannot be posted to it.
  const {
    init,
    dispose,
    actions: _actions,
    extensions: _workerExtensions,
    clientExtensions,
    ...options
  } = config

  return createPGliteProvider({
    create: () =>
      PGliteWorker.create(
        new Worker(new URL('./worker', import.meta.url), { type: 'module', name: 'pglite' }),
        { ...options, extensions: clientExtensions },
      ),
    init,
    dispose,
  })
}

let provider: PGliteProvider<Instance> | undefined

/** The browser-side provider; `use()` creates the worker on first call. */
export const pglite: PGliteProvider<Instance> = {
  use: () => (provider ??= createProvider()).use(),
  get instance() {
    return provider?.instance
  },
  close: () => provider?.close() ?? Promise.resolve(),
}

/** The in-browser PGlite instance, created on first use. Client-side only. */
export function usePGlite(): Promise<Instance> {
  if (import.meta.server) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Client-side only',
      message: '[nuxt-pglite] `usePGlite()` from `#pglite/client` runs in the browser only.',
    })
  }
  return pglite.use()
}
