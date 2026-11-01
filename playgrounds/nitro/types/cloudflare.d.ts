// The Workers builtin, absent on Node: `useDB` probes it. Typed here rather
// than through `@cloudflare/workers-types`, since this playground never runs
// on Workers; the Nuxt 5 playground does and uses the real types.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>
}
