export type ConfigKind = 'server' | 'client'

export interface EnvOverrides<C> {
  /** Applied in `nuxt dev`. */
  $development?: Partial<C>
  /** Applied in a production build. */
  $production?: Partial<C>
  /** Applied while testing; wins over the two above. */
  $test?: Partial<C>
}

/**
 * Set by the define helpers, as an enumerable symbol so that it survives
 * spreading, and checked where a config is loaded: the server and client
 * shapes are alike enough that a swap would only fail at runtime otherwise.
 */
const KIND = Symbol.for('nuxt-pglite:config-kind')

export function markConfig<C extends object>(config: C, kind: ConfigKind): C {
  Object.defineProperty(config, KIND, { value: kind, enumerable: true })
  return config
}

export function assertConfigKind<C extends object>(config: C, kind: ConfigKind, file: string): C {
  const marked: unknown = Reflect.get(config, KIND)
  if (marked !== undefined && marked !== kind) {
    const helper = kind === 'server' ? 'definePGliteServerConfig' : 'definePGliteClientConfig'
    throw new Error(`[nuxt-pglite] ${file} must use ${helper}(): it is the ${kind}-side config.`)
  }
  return config
}

/** Applies the `$development` / `$production` / `$test` overrides and drops them. */
export function resolveEnvConfig<C extends object>(
  config: C & EnvOverrides<C>,
  env: { dev: boolean; test: boolean },
): C {
  const overrides = env.test ? config.$test : env.dev ? config.$development : config.$production
  const resolved: C & EnvOverrides<C> = { ...config, ...overrides }
  delete resolved.$development
  delete resolved.$production
  delete resolved.$test
  return resolved
}
