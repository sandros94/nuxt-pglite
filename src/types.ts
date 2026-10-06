import type { ExtensionName, PGliteOptions, PGliteWorkerOptions } from './runtime/types'

export type * from './runtime/types'

export interface ModuleOptions {
  client?: {
    enabled?: boolean
    extensions?: ExtensionName[]
    liveQuery?: boolean
    options?: Omit<PGliteWorkerOptions, 'extensions' | 'fs'>
  }
  server?: {
    enabled?: boolean
    extensions?: ExtensionName[]
    options?: Omit<PGliteOptions, 'extensions' | 'fs'>
  }
}

/**
 * `@nuxt/module-builder` picks these up from the module's exports and emits the
 * matching `@nuxt/schema` augmentations into `dist/types.d.mts`.
 */
export interface ModulePublicRuntimeConfig {
  pglite: Exclude<ModuleOptions['client'], undefined>['options']
}

export interface ModuleRuntimeConfig {
  pglite: Exclude<ModuleOptions['server'], undefined>['options']
}
