import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    /**
     * The real database when `DATABASE_URL` is set, the development socket
     * otherwise: it is pinned to a port in `nuxt.config.ts` so that tooling
     * finds it while `nuxt dev` runs.
     */
    url: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5456/postgres',
  },
})
