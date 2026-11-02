export default defineNuxtConfig({
  compatibilityDate: 'latest',

  modules: ['nuxt-pglite'],

  pglite: {
    // PGlite in `nuxt dev` only: production reaches Postgres through Hyperdrive.
    server: { enabled: false },
    socket: { port: 5459 },
  },

  nitro: {
    preset: 'cloudflare_module',
    // `pg` requires `pg-native` behind a lazy getter, which Rollup bundles
    // eagerly and Workers cannot load; the getter is never read.
    alias: { 'pg-native': 'unenv/mock/empty' },
    // Writes `.output/server/wrangler.json` and the redirect `wrangler dev`
    // and `wrangler deploy` follow; Nitro 2 enables it on Cloudflare's CI only.
    cloudflare: { deployConfig: true },
  },

  typescript: {
    // The suite runs in Node, next to the config, outside the app and server projects.
    nodeTsConfig: { include: ['../vitest.config.ts', '../test/**/*'] },
  },
})
