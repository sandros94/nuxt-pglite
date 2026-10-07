# Nuxt PGlite

[![npm version][npm-version-src]][npm-version-href] [![npm downloads][npm-downloads-src]][npm-downloads-href] [![License][license-src]][license-href] [![Nuxt][nuxt-src]][nuxt-href]

A Nuxt module aimed to simplify the use of [PGlite](https://pglite.dev).

> PGlite, an Embeddable Postgres Run a full Postgres database locally in WASM with reactivity and live sync.

- [✨ &nbsp;Release Notes](/CHANGELOG.md)

<!-- - [🏀 Online playground](https://stackblitz.com/github/sandros94/nuxt-pglite?file=playground%2Fapp.vue) -->
<!-- - [📖 &nbsp;Documentation](https://example.com) -->

## What it is

Tooling around [PGlite](https://pglite.dev) for Nuxt apps, in three independent pieces you combine as you like:

- **Server**: a lazily created PGlite instance for your Nitro routes (`usePGlite()`), configured in `server/pglite.config.ts`.
- **Development socket**: the same instance served over the Postgres wire protocol while `nuxt dev` runs, so your `pg`/postgres.js/Drizzle code, `drizzle-kit`, `psql` and friends talk to PGlite through a `DATABASE_URL` exactly as they will talk to Postgres in production.
- **Client**: an in-browser PGlite in a Web Worker shared between tabs, with live-query composables, configured in `app/pglite.config.ts`. Off by default.

Each piece is only in your bundle when it is enabled. `@electric-sql/pglite` is a peer dependency, so you pick its version and import extensions yourself: nothing is wrapped, and the types follow your config.

The framework-agnostic parts ship as their own entries: `nuxt-pglite/core` (config helper + lazy provider) and `nuxt-pglite/socket` (the wire-protocol server), usable from any Node server.

## Quick setup

```bash
npx nuxi module add nuxt-pglite
npm i @electric-sql/pglite
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-pglite'],
})
```

```ts
// server/api/hello.get.ts
export default defineEventHandler(async () => {
  const pg = await usePGlite()
  return pg.query('SELECT now()')
})
```

Data lives in `.data/pglite` under your project by default. Set `pglite.server.options.dataDir` in `nuxt.config.ts` (relative paths are resolved from the root directory at build time), or `NUXT_PGLITE_DATA_DIR` at runtime.

## Server

### Config file

Extensions, a data directory decided at runtime and setup code go in `server/pglite.config.ts`:

```ts
import { citext } from '@electric-sql/pglite/contrib/citext'
import { vector } from '@electric-sql/pglite-pgvector'

export default definePGliteConfig({
  extensions: { citext, vector },
  init: async (pg) => {
    await pg.exec('CREATE EXTENSION IF NOT EXISTS vector')
  },
  dispose: async (pg) => {
    // runs before the instance is closed on server shutdown
  },
})
```

`definePGliteConfig` is auto-imported; import it from `nuxt-pglite/core` if the file is also loaded outside Nuxt. The accepted options are PGlite's own ([reference](https://pglite.dev/docs/api#options)) plus `init` and `dispose`. A relative `dataDir` here is resolved from the working directory at runtime, like Nitro's storage; prefer `nuxt.config.ts` for a project-relative path.

On Nuxt 5 (Nitro 3) dependencies are bundled, which would separate PGlite and its extension packages from the wasm and extension bundles they load at runtime. The module keeps them whole by tracing PGlite and every package the config file imports (relative imports included). A package reached some other way goes in Nitro's own list, `nitro.traceDeps`.

The file path is `pglite.server.config` in `nuxt.config.ts`. `usePGlite()` is typed from it, so `pg.live` or any extension namespace is there when configured.

### Options

```ts
export default defineNuxtConfig({
  pglite: {
    server: {
      enabled: true, // `false` removes PGlite from the server bundle
      config: 'server/pglite.config',
      options: { dataDir: '.data/pglite' }, // build-time defaults the config file can override
      eager: false, // create the instance at startup instead of on first use
      socket: false, // see below
    },
  },
})
```

Use `enabled: import.meta.dev` or an environment check to keep PGlite out of a production build that uses a real database.

## Development socket

```ts
export default defineNuxtConfig({
  pglite: {
    server: {
      socket: { port: 5433 }, // or `true` for a random port
    },
  },
})
```

While `nuxt dev` runs, the module creates the configured instance in the Nuxt process and serves it over TCP. The URL is logged, set as `DATABASE_URL` if that variable is unset (`socket.env` renames or disables this), and available as `useRuntimeConfig().pglite.url`.

Your database code then needs no PGlite branch at all:

```ts
// server/utils/db.ts
import { drizzle } from 'drizzle-orm/node-postgres'

export function useDB() {
  return drizzle(process.env.DATABASE_URL!)
}
```

and tooling finds the same database:

```ts
// drizzle.config.ts
export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: { url: 'postgres://postgres@127.0.0.1:5433/postgres' },
})
```

Options: `host`, `port`, `path` (a directory for a Unix socket), `env`, `maxConnections`, `idleInTransactionTimeout`.

PGlite allows one instance per data directory, so `usePGlite()` in your routes refuses the directory the socket serves; connect through the URL instead, or give the server instance another `dataDir`. Tested with `pg`, postgres.js, `psql` and `drizzle-kit push`; one client owns the database at a time for the length of a transaction or pipeline, others queue.

## Client

```ts
export default defineNuxtConfig({
  pglite: {
    client: {
      enabled: true,
      config: 'app/pglite.config',
      options: { dataDir: 'idb://my-app' },
      eager: false,
    },
  },
})
```

```ts
// app/pglite.config.ts
import { live } from '@electric-sql/pglite/live'
import { vector } from '@electric-sql/pglite-pgvector'

export default definePGliteClientConfig({
  dataDir: 'idb://my-app',
  extensions: { vector }, // loaded in the worker, next to the database
  clientExtensions: { live }, // loaded on the main thread, typed on the instance
  init: async (pg) => {
    await pg.exec('CREATE TABLE IF NOT EXISTS todos (id serial, title text)')
  },
})
```

The database runs in a Web Worker; tabs share it. Postgres extensions go in `extensions`, extensions that add a JavaScript namespace (`live`, `electricSync`) in `clientExtensions`, which is how PGlite itself splits them.

```vue
<script setup lang="ts">
const pg = await usePGlite()
const { rows } = useLiveQuery<{ id: number; title: string }>('SELECT * FROM todos ORDER BY id')

async function add(title: string) {
  await pg.query('INSERT INTO todos (title) VALUES ($1)', [title])
}
</script>
```

`useLiveQuery(query, params?)` and `useLiveIncrementalQuery(query, params, key)` accept strings, refs or getters and re-subscribe when they change; `useLiveQuery.sql` is a tagged-template form. They need `live` in `clientExtensions`. All of these are client-only; call them from `.client.vue` components or behind `<ClientOnly>`.

Server and client composables share the name `usePGlite`: the auto-import resolves to the right one per context, and `#pglite/server` / `#pglite/client` import either explicitly.

## Outside Nuxt

```ts
import { createPGliteProvider, definePGliteConfig } from 'nuxt-pglite/core'
import { createPGliteSocketServer } from 'nuxt-pglite/socket'

const pglite = createPGliteProvider(definePGliteConfig({ dataDir: './data' }))
const db = await pglite.use()

const server = await createPGliteSocketServer(db, { port: 5433 }).listen()
console.log(server.url)
// ...
await server.close()
await pglite.close()
```

Both entries import only `@electric-sql/pglite` and Node built-ins.

## Contribution

<details>
  <summary>Local development</summary>

```bash
# Install dependencies (also stubs dist/ and prepares the playground)
pnpm install

# Develop with the playground
pnpm dev

# Lint and format
pnpm lint
pnpm fmt

# Typecheck (module sources with tsc, playground with golar)
pnpm typecheck

# Test
pnpm test
pnpm test:unit
pnpm test:e2e

# Build the module
pnpm build
```

</details>

<details>
  <summary>Releasing</summary>

Releases are automated by [uppt](https://github.com/danielroe/uppt): pushing to `main` opens a draft `release/vX.Y.Z` PR built from the conventional commits since the last tag. Merging it tags the commit, publishes the GitHub Release, then packs and stages the tarball to npm through OIDC trusted publishing — which waits for your 2FA approval in the `npm` environment.

Nothing to run locally; just write conventional commits.

</details>

## License

Published under the [MIT](/LICENSE) license.

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/nuxt-pglite/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/nuxt-pglite
[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-pglite.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npmjs.com/package/nuxt-pglite
[license-src]: https://img.shields.io/npm/l/nuxt-pglite.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/nuxt-pglite
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
