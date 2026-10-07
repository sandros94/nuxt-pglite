/**
 * Framework-agnostic PGlite helpers: configuration and lazy instance
 * management, so it stays usable from any runtime, browser included.
 */
export { definePGliteConfig } from './config'
export type { PGliteConfig, PGliteInstanceFor } from './config'
export { createPGliteProvider } from './provider'
export type { Closable, PGliteProvider, PGliteProviderOptions } from './provider'
