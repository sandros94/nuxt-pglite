import { useRuntimeConfig } from 'nuxt/server'

import { createPGliteProvider } from '../../core'
import type { PGliteProvider } from '../../core'
import config, { socketDataDir } from '#pglite/server-config'

type Provider = ReturnType<typeof createProvider>

function createProvider() {
  const { dataDir } = useRuntimeConfig().pglite
  const resolved = dataDir ? { ...config, dataDir } : config

  if (socketDataDir !== undefined && resolved.dataDir === socketDataDir) {
    throw new Error(
      `[nuxt-pglite] The development socket already serves "${socketDataDir}" from the Nuxt process, and PGlite allows one instance per data directory. Connect through the socket URL (\`useRuntimeConfig().pglite.url\`) or give the server instance a different \`dataDir\`.`,
    )
  }

  return createPGliteProvider(resolved)
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
