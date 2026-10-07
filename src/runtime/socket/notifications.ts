import type { PGlite } from '@electric-sql/pglite'

import type { Connection } from './connection'
import { buildNotificationResponse } from './protocol'

/**
 * Subscribes to PGlite's `onNotification` callback and broadcasts each
 * notification to every connection as a wire-protocol NotificationResponse
 * message.
 *
 * PGlite exposes a single internal session. When multiple clients share it, a
 * NOTIFY triggered by one client produces a NotificationResponse in that
 * client's `execProtocolRaw` response, not on the socket of the client that
 * called LISTEN. Hooking into `onNotification`
 * (https://pglite.dev/docs/api#onnotification) and writing to every
 * connection delivers notifications regardless of which connection triggered
 * the NOTIFY. The backend strips the NotificationResponse messages from
 * `execProtocolRaw` responses, so each notification is delivered exactly once.
 *
 * Returns an unsubscribe function that stops the broadcast.
 */
export function broadcastNotifications(db: PGlite, connections: Iterable<Connection>): () => void {
  return db.onNotification((channel, payload) => {
    const message = buildNotificationResponse(channel, payload)

    for (const connection of connections) {
      connection.notify(message)
    }
  })
}
