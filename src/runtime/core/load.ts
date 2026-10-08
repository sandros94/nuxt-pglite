import { definePGliteClientConfig } from '../client/config'
import { definePGliteConfig } from './config'
import type { PGliteConfig } from './config'
import { assertConfigKind } from './kind'

// Both helpers, so that a file using the wrong one reaches the kind check and
// gets a pointer instead of a ReferenceError.
const HELPERS: Record<string, unknown> = {
  definePGliteServerConfig: definePGliteConfig,
  definePGliteClientConfig,
}

// Concurrent loads share the globals: the last one to finish removes them, so
// that none is left without them halfway through its import.
let loading = 0
let provided: string[] = []

/**
 * Imports a server config file outside the server bundle, where
 * `definePGliteServerConfig` is not auto-imported: the define helpers are
 * provided as globals for the duration of the import (those already defined
 * are left alone), so that a file written for the server works unchanged.
 * `load` imports the file, which lets each caller pick a loader that handles
 * TypeScript in its runtime.
 */
export async function importServerConfig(
  path: string,
  load: (path: string) => Promise<{ default: PGliteConfig }>,
): Promise<PGliteConfig> {
  const global: Record<string, unknown> = globalThis
  if (loading++ === 0) {
    provided = Object.keys(HELPERS).filter((name) => !(name in global))
    for (const name of provided) {
      global[name] = HELPERS[name]
    }
  }
  try {
    const { default: config } = await load(path)
    return assertConfigKind(config, 'server', path)
  } finally {
    if (--loading === 0) {
      for (const name of provided) {
        delete global[name]
      }
      provided = []
    }
  }
}
