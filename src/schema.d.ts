import type { ModuleHooks, ModuleRuntimeConfig } from './types'

/**
 * Types the module's runtime config for the module's *own* sources; consumers
 * get the augmentation module-builder emits into `dist/types.d.mts`.
 *
 * - Ambient and imported by nothing, so the stubbed `dist/` cannot pull it into
 *   a consumer, where it would clash with the keys Nuxt generates from config.
 * - Keys are declared as own members rather than through `extends`: an own
 *   member always wins over an inherited one, while conflicting bases silently
 *   resolve to whichever comes first.
 * - Augments `nuxt/schema`, not `@nuxt/schema`: in the server context only the
 *   former reaches what `nuxt/server`'s `useRuntimeConfig` returns.
 */
declare module 'nuxt/schema' {
  interface RuntimeConfig {
    pglite: ModuleRuntimeConfig['pglite']
  }
}

// The module's own `nuxt.callHook()`s, typed like the runtime config above.
declare module '@nuxt/schema' {
  interface NuxtHooks {
    'pglite:devtools:actions': ModuleHooks['pglite:devtools:actions']
    'pglite:devtools:prompt': ModuleHooks['pglite:devtools:prompt']
  }
}
