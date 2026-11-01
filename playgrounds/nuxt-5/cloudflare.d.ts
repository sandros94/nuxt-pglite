/// <reference types="@cloudflare/workers-types" />

// The bindings declared in `wrangler.jsonc`, typed on `env` from `cloudflare:workers`.
// At the root rather than in `server/`: the app project checks the server
// routes too, for the typed `useFetch`.
declare namespace Cloudflare {
  interface Env {
    HYPERDRIVE: Hyperdrive
  }
}
