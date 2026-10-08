import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { createJiti } from 'jiti'

import type { PGliteConfig } from '../core/config'
import { resolveEnvConfig } from '../core/kind'
import { importServerConfig } from '../core/load'

/** How the module resolves `$development` / `$production` / `$test` while testing: `$test` applies. */
export const TEST_ENV = { dev: false, test: true }

// The extensions `pglite.server.config` may leave out, in the order tried.
const EXTENSIONS = ['', '.ts', '.mts', '.js', '.mjs']

export interface LoadPGliteConfigOptions {
  /**
   * Import aliases the file may use (`~~`, `#pglite/*`, …), as `nuxt.options.alias`
   * holds them: name to absolute path.
   */
  alias?: Record<string, string>
}

/**
 * Loads the app's server config file (`server/pglite.config.ts`) as the
 * module does: relative to `process.cwd()`, extension optional, with
 * `definePGliteServerConfig` available as a global, and with the `$test`
 * overrides applied. The file is imported through jiti, so TypeScript works
 * on any runtime, and `alias` resolves the imports the app's aliases would.
 */
export async function loadPGliteConfig(
  path: string,
  { alias }: LoadPGliteConfigOptions = {},
): Promise<PGliteConfig> {
  const file = await findConfigFile(isAbsolute(path) ? path : resolve(process.cwd(), path))
  const jiti = createJiti(process.cwd(), { alias })
  const config = await importServerConfig(file, (target) => jiti.import(target))
  return resolveEnvConfig(config, TEST_ENV)
}

async function findConfigFile(path: string): Promise<string> {
  const found = await Promise.all(
    EXTENSIONS.map((extension) =>
      stat(path + extension).then(
        (stats) => (stats.isFile() ? path + extension : undefined),
        () => undefined,
      ),
    ),
  )
  const file = found.find((candidate) => candidate !== undefined)
  if (!file) {
    throw new Error(`[nuxt-pglite] No PGlite config file at ${path}.`)
  }
  return file
}
