import { fileURLToPath } from 'node:url'

import type { PGliteSocketAction } from 'nuxt-pglite'

const playground = fileURLToPath(new URL('.', import.meta.url))

/** Runs a drizzle-kit command in a DevTools terminal, reaching the socket through its variables. */
function drizzleKit(id: string, label: string, command: string): PGliteSocketAction {
  return {
    id,
    label,
    run: ({ env, startSubprocess }) => {
      startSubprocess(
        {
          command: 'pnpm',
          args: ['exec', 'drizzle-kit', command],
          cwd: playground,
          env: { ...process.env, ...env },
        },
        { id, name: label },
      )
    },
  }
}

export default defineNuxtConfig({
  compatibilityDate: 'latest',
  devtools: { enabled: true },

  modules: ['nuxt-pglite'],

  pglite: {
    client: {
      enabled: true,
    },
    socket: {
      port: 5455,
      // The map form of `env`; `'DATABASE_URL'` alone is the same. A hosting
      // provider's variables come from its preset, e.g. `provider: 'netlify'`
      // for `NETLIFY_DB_URL` and `NETLIFY_DB_DRIVER=server`.
      env: { DATABASE_URL: (url: string) => url },
      actions: [
        {
          id: 'socket-url',
          label: 'Print the socket URL',
          run: ({ socketUrl, env, logger }) => {
            logger.info(socketUrl)
            // What a spawned CLI would receive to reach the socket.
            return { socketUrl, env }
          },
        } satisfies PGliteSocketAction,
        drizzleKit('drizzle-generate', 'Generate a migration', 'generate'),
        drizzleKit('drizzle-studio', 'Open Drizzle Studio', 'studio'),
      ],
    },
  },

  $test: {
    nitro: {
      preset: 'node-server',
    },
  },
})
