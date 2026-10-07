import type { PGlite } from '@electric-sql/pglite'

import type { Backend } from './backend'

/**
 * Routes PGlite's notifications to the clients that LISTEN on their channel.
 *
 * PGlite exposes a single internal session: a NOTIFY run by one client shows
 * up in that client's `execProtocolRaw` response, not on the socket of the
 * client that ran LISTEN. The backend strips those NotificationResponse
 * messages from the responses, and `onNotification`
 * (https://pglite.dev/docs/api#onnotification) delivers each notification
 * here once, to be written to the listening sessions.
 *
 * Returns an unsubscribe function.
 */
export function routeNotifications(db: PGlite, backend: Backend): () => void {
  return db.onNotification((channel, payload) => backend.notify(channel, payload))
}
