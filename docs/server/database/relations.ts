import { defineRelations } from 'drizzle-orm'

import * as schema from './schema'

/** Enables `db.query`; `visits` has no relations to declare. */
export const relations = defineRelations(schema)
