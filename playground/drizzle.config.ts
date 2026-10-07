import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './server/database/migrations',
  schema: './server/database/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    /**
     * The development socket, pinned to a port in `nuxt.config.ts` so that
     * tooling can find it while `nuxt dev` is running.
     */
    url: 'postgres://postgres@127.0.0.1:5433/postgres',
  },
})
