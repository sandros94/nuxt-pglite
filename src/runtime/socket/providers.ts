/** Hosting providers whose database variables the socket can stand in for. */
export type SocketProvider = 'netlify'

/**
 * The variables each provider sets for its managed database, as functions of
 * the socket URL. Only these: code that reads them in production must find
 * the socket under the same names in development, and nothing else, so that
 * it is not taught to read a variable the provider never sets.
 */
export const SOCKET_PROVIDERS: Record<SocketProvider, Record<string, (url: string) => string>> = {
  netlify: {
    NETLIFY_DB_URL: (url) => url,
    // `getDatabase()` from `@netlify/database` reads this: `serverless` picks
    // Neon's HTTP/WebSocket driver, which the socket cannot answer; `server`
    // picks `pg` over the wire protocol, which it speaks.
    NETLIFY_DB_DRIVER: () => 'server',
  },
}
