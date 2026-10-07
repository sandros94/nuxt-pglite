/**
 * What `#pglite/server` resolves to while `pglite.server` is disabled: the
 * same names, no PGlite behind them, so a stray import fails with a pointer
 * instead of pulling the engine into the bundle.
 */
export { definePGliteConfig as definePGliteServerConfig } from '../core'
export type { PGliteConfig, PGliteInstanceFor } from '../core'

const message =
  '[nuxt-pglite] `pglite.server` is disabled: `usePGlite()` has no instance. Enable it, or connect to `useRuntimeConfig().pglite.url` if you are using the development socket.'

export function usePGlite(): Promise<never> {
  return Promise.reject(new Error(message))
}

export const pglite = {
  use: usePGlite,
  instance: undefined,
  close: () => Promise.resolve(),
}
