import { defineRelations } from 'drizzle-orm'

import * as schema from './schema'

/** Enables `db.query`; the tables have no relations to declare yet. */
export const relations = defineRelations(schema)
