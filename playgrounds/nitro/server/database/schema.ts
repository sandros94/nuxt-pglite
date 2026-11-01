import { pgTable, serial, timestamp } from 'drizzle-orm/pg-core'

export const visits = pgTable('visits', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
