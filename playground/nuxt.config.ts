import type { PGliteProcessAction } from 'nuxt-pglite'

export default defineNuxtConfig({
  compatibilityDate: 'latest',
  devtools: { enabled: true },

  modules: ['nuxt-pglite'],

  pglite: {
    client: {
      enabled: true,
    },
    server: {
      socket: {
        port: 5455,
        // The map form of `env`; `'DATABASE_URL'` alone is the same. A hosting
        // provider's variables come from its preset, e.g. `provider: 'netlify'`
        // for `NETLIFY_DB_URL` and `NETLIFY_DB_DRIVER=server`.
        env: { DATABASE_URL: (url: string) => url },
      },
    },
    devtools: {
      actions: [
        {
          id: 'socket-url',
          label: 'Print the socket URL',
          run: ({ socketUrl, env, logger }) => {
            logger.info(socketUrl ?? 'The socket is not running.')
            // What a spawned CLI would receive to reach the socket.
            return { socketUrl, env }
          },
        } satisfies PGliteProcessAction,
      ],
    },
  },

  $test: {
    nitro: {
      preset: 'node-server',
    },
  },
})
