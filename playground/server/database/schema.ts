import { text, pgTable, serial } from 'drizzle-orm/pg-core'

export const test = pgTable('test', {
  id: serial('id').primaryKey(),
  name: text('name'),
})

export const tables = { test }
