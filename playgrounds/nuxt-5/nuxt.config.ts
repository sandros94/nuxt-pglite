export default defineNuxtConfig({
  compatibilityDate: 'latest',

  modules: ['nuxt-pglite'],

  pglite: {
    // PGlite in `nuxt dev` only: production reaches Postgres through Hyperdrive.
    server: { enabled: false },
    socket: { port: 5458 },
  },

  nitro: {
    preset: 'cloudflare_module',
    // The preset's dev server runs in miniflare, which has no Hyperdrive to
    // offer locally; on Node the app reaches the socket through `DATABASE_URL`.
    devServer: { runner: 'node-worker' },
  },

  typescript: {
    // Nuxt 5 checks `nuxt.config.ts` under `nodenext`. The stubbed module's
    // declarations re-export its sources, whose relative imports carry no
    // extension; a built module type-checks without this.
    nodeTsConfig: {
      compilerOptions: { module: 'preserve', moduleResolution: 'bundler' },
      // The suite runs in Node, next to the config, outside the app and server projects.
      include: ['../vitest.config.ts', '../test/**/*'],
    },
  },
})
