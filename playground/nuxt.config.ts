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
      socket: { port: 5455 },
    },
    devtools: {
      actions: [
        {
          id: 'socket-url',
          label: 'Print the socket URL',
          run: ({ socketUrl, logger }) => {
            logger.info(socketUrl ?? 'The socket is not running.')
            return socketUrl
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
