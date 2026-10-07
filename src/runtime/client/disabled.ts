/**
 * What `#pglite/client` resolves to while `pglite.client` is disabled: the
 * same names, no PGlite behind them, so a stray import fails with a pointer
 * instead of pulling the engine into the bundle.
 */
export { definePGliteClientConfig } from './config'
export type { PGliteClientConfig, PGliteClientInstanceFor } from './config'

const message =
  '[nuxt-pglite] `pglite.client` is disabled: `usePGlite()` has no instance in the browser.'

export function usePGlite(): Promise<never> {
  return Promise.reject(new Error(message))
}

export const pglite = {
  use: usePGlite,
  instance: undefined,
  close: () => Promise.resolve(),
}

function disabled(): never {
  throw new Error(message)
}

export const useLiveQuery = disabled
export const useLiveIncrementalQuery = disabled
