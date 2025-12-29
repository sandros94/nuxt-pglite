import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './server/database/migrations',
  schema: './server/database/schema.ts',
  driver: 'pglite',
  dialect: 'postgresql',
  dbCredentials: {
    url: './.data/pglite',
  },
})
