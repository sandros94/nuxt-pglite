import { defineConfig } from 'drizzle-kit'

// Netlify applies the files in `out` on deploy and `init` (`server/pglite.config.ts`) applies them locally: no `push`/`migrate`.
export default defineConfig({
  out: './netlify/database/migrations',
  schema: './server/database/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    /**
     * The development socket, pinned to a port in `nuxt.config.ts` so that
     * tooling (`studio`, `check`) can find it while `nuxt dev` is running.
     */
    url: 'postgres://postgres@127.0.0.1:5456/postgres',
  },
})
