import { SOCKET_PROVIDERS } from './providers'
import type { SocketProvider } from './providers'

/**
 * Variables to export for the socket, by name: a function receives the socket
 * URL, a string is exported as is.
 */
export type SocketEnv = Record<string, string | ((url: string) => string)>

export interface SocketEnvOptions {
  env?: string | false | SocketEnv
  provider?: SocketProvider
}

/**
 * The variables the socket exports, with their values: `DATABASE_URL` by
 * default, the provider's variables in its place when one is set, the `env`
 * map merged over them. A string `env` names a single variable for the URL;
 * `false` exports nothing.
 */
export function resolveSocketEnv(
  { env, provider }: SocketEnvOptions,
  url: string,
): Record<string, string> {
  if (env === false) {
    return {}
  }

  const own: SocketEnv =
    typeof env === 'string' ? { [env]: url } : (env ?? (provider ? {} : { DATABASE_URL: url }))
  const merged: SocketEnv = { ...(provider ? SOCKET_PROVIDERS[provider] : {}), ...own }

  return Object.fromEntries(
    Object.entries(merged).map(([name, value]) => [
      name,
      typeof value === 'function' ? value(url) : value,
    ]),
  )
}
