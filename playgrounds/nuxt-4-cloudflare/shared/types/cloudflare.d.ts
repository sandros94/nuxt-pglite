/// <reference types="@cloudflare/workers-types" />

// The bindings declared in `wrangler.jsonc`, typed on `env` from `cloudflare:workers`.
// In `shared/`, which Nuxt 4's app and server projects both include: the app
// project checks the server routes too, for the typed `useFetch`.
declare namespace Cloudflare {
  interface Env {
    HYPERDRIVE: Hyperdrive
  }
}
