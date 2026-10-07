import { useRuntimeConfig } from 'nuxt/server'

import { createPGliteProvider } from '../../core'
import type { InitScope, PGliteProvider } from '../../core'
import config, { socketDataDir } from '#pglite/server-config'

type Provider = ReturnType<typeof createProvider>

/** The config with its runtime overrides applied: what the instance is created from. */
export function resolveServerConfig(): typeof config {
  const { dataDir } = useRuntimeConfig().pglite
  return dataDir ? { ...config, dataDir } : config
}

function createProvider() {
  const resolved = resolveServerConfig()

  if (socketDataDir !== undefined && resolved.dataDir === socketDataDir) {
    throw new Error(
      `[nuxt-pglite] The development socket already serves "${socketDataDir}" from the Nuxt process, and PGlite allows one instance per data directory. Connect through the socket URL (\`useRuntimeConfig().pglite.url\`) or give the server instance a different \`dataDir\`.`,
    )
  }

  return createPGliteProvider(resolved, { initScope })
}

// Lets `usePGlite()` fail fast when called from `init`, where it would
// otherwise wait for the initialisation it is part of. `node:async_hooks` is
// loaded when `init` runs and skipped where the runtime lacks it, which only
// costs that diagnostic.
let initialising:
  | { run<R>(store: true, fn: () => Promise<R>): Promise<R>; getStore(): true | undefined }
  | undefined

const initScope: InitScope = {
  async run(fn) {
    initialising ??= await import('node:async_hooks')
      .then(({ AsyncLocalStorage }) => new AsyncLocalStorage<true>())
      .catch(() => undefined)
    return initialising ? initialising.run(true, fn) : fn()
  },
  active: () => initialising?.getStore() === true,
}

let provider: Provider | undefined

/**
 * Resolved on first use rather than at import: runtime config is not readable
 * while the server bundle is evaluated, and a misconfiguration should surface
 * where the instance is asked for, not in every route.
 */
export const pglite: PGliteProvider<Awaited<ReturnType<Provider['use']>>> = {
  use: () => (provider ??= createProvider()).use(),
  get instance() {
    return provider?.instance
  },
  close: () => provider?.close() ?? Promise.resolve(),
}

/** The server-side PGlite instance, created on first use. */
export function usePGlite() {
  return pglite.use()
}
