import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { NitroModule } from 'nitro/types'

// Relative rather than `nuxt-pglite/core` and `nuxt-pglite/socket`: in this
// monorepo the module is stubbed, and its `dist` has no built files for the
// package exports to reach.
import { createPGliteProvider, definePGliteConfig } from '../../../src/runtime/core'
import { createPGliteSocketServer } from '../../../src/runtime/socket'

/**
 * Serves PGlite over the Postgres wire protocol while `nitro dev` runs, from
 * the Nitro process rather than the dev worker, so that it survives reloads.
 * `DATABASE_URL` is exported for the worker, unless already set.
 */
export default {
  name: 'pglite-socket',
  async setup(nitro) {
    if (!nitro.options.dev) {
      return
    }
    const dataDir = resolve(nitro.options.rootDir, '.data/pglite')
    // PGlite creates `dataDir` itself, but not its parents.
    await mkdir(dirname(dataDir), { recursive: true })
    const pglite = createPGliteProvider(
      definePGliteConfig({
        dataDir,
        init: (pg) =>
          pg.exec(`
            CREATE TABLE IF NOT EXISTS visits (
              id serial PRIMARY KEY,
              created_at timestamptz NOT NULL DEFAULT now()
            )
          `),
      }),
    )
    const server = await createPGliteSocketServer(await pglite.use(), { port: 5457 }).listen()
    process.env.DATABASE_URL ||= server.url
    nitro.logger.info(`PGlite socket listening at ${server.url}`)
    nitro.hooks.hook('close', async () => {
      await server.close()
      await pglite.close()
    })
  },
} satisfies NitroModule
