import { defineEventHandler, readBody } from 'nuxt/server'

import { describeInstance, runAction, runQuery } from '../../core/actions'
import { resolveServerConfig, usePGlite } from '../utils/pglite'

/**
 * The server instance's side of the devtools tab, registered in development
 * only and only while the instance lives in Nitro (no development socket).
 *
 * - `GET`: the instance's config and actions.
 * - `POST { query }`: runs SQL, every statement of it.
 * - `POST { action }`: runs the server action with that id.
 *
 * Failures are part of the response (`{ ok: false, error }`), not HTTP errors,
 * so the page shows them where they happened.
 */
export default defineEventHandler(async (event) => {
  const config = resolveServerConfig()
  if (event.req.method !== 'POST') {
    return describeInstance(config, 'server')
  }

  const body = await readBody<{ query?: unknown; action?: unknown }>(event)
  if (typeof body?.query === 'string') {
    return runQuery(usePGlite, body.query)
  }
  if (typeof body?.action === 'string') {
    return runAction(config.devtoolsActions, 'server', body.action, async () => ({
      pg: await usePGlite(),
    }))
  }
  return { ok: false, error: 'Expected `{ query }` or `{ action }`.' }
})
