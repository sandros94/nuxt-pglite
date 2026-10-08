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

export default definePGliteServerConfig({
  extensions: { citext, vector },
  init: async (pg) => {
    await pg.exec('CREATE EXTENSION IF NOT EXISTS vector')
  },
  dispose: async (pg) => {
    // runs before the instance is closed on server shutdown
  },
})
```

`definePGliteServerConfig` is auto-imported (it is `definePGliteConfig` from `nuxt-pglite/core` under its Nuxt name; import that one if the file is also loaded outside Nuxt). Using the client helper here, or this one in the client file, fails at load with a pointer. The accepted options are PGlite's own ([reference](https://pglite.dev/docs/api#options)) plus `init` and `dispose`. A relative `dataDir` here is resolved from the working directory at runtime, like Nitro's storage; prefer `nuxt.config.ts` for a project-relative path.

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

`$development`, `$production` and `$test` keys work in the config file as they do in `nuxt.config.ts`:

```ts
export default definePGliteServerConfig({
  extensions: { vector },
  $development: { dataDir: 'memory://' },
})
```

A config file that exists while its side is disabled (and, for the server, has no socket) logs a warning, since it is not used.

### PGlite in development only

The socket does not depend on the server side, so it works with it disabled. Nothing from PGlite ends up in the build, and the same driver code reads the real `DATABASE_URL` in production:

```ts
export default defineNuxtConfig({
  pglite: {
    server: {
      enabled: false, // no `usePGlite()`, no PGlite in the output
      socket: { port: 5433 }, // but a Postgres URL while `nuxt dev` runs
    },
  },
})
```

With the server side disabled, `#pglite/server` still resolves to a stub whose `usePGlite()` rejects with a pointer, so a leftover import fails clearly rather than at bundling.

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

While `nuxt dev` runs, the module creates the configured instance and serves it over TCP, so anything that speaks Postgres connects to it as it would to a normal server. The URL is logged, set as `DATABASE_URL` if that variable is unset (`socket.env` renames or disables this), and available as `useRuntimeConfig().pglite.url`.

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

PGlite allows one instance per data directory, so `usePGlite()` in your routes refuses the directory the socket serves; connect through the URL instead, or give the server instance another `dataDir`. Tested with `pg`, postgres.js, `psql` and `drizzle-kit push`, on Node, Bun and Deno. One client owns the database at a time for the length of a transaction or pipeline, others queue; the process's own `db.query()` / `db.transaction()` calls queue the same way, so neither side's statements land inside the other's transaction. An owner that stays idle inside a transaction or pipeline past `idleInTransactionTimeout` is disconnected. Notifications reach the clients that ran `LISTEN` on the channel, and a client's settings, temp tables, advisory locks and subscriptions are dropped when it disconnects, as a real server would; the settings the process set before the server started are kept.

Known differences from a real server, inherent to one shared session: `COPY … FROM STDIN` is refused (`0A000`, PGlite cannot run it); `LISTEN`/`UNLISTEN` and SQL-level `PREPARE` / `EXECUTE` / `DEALLOCATE` are recognised as single statements, the way drivers send them, and `LISTEN` takes effect regardless of the transaction it ran in; temp tables and advisory locks taken by the process itself are released when any client disconnects.

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

## Development tools

In `nuxt dev`, and only there, the module adds a **PGlite** tab to [Nuxt DevTools](https://devtools.nuxt.com): the configuration of each side, the socket URL with its live connection count, an SQL box for each instance (the server's, and the browser's in the app's tab) and your **actions**. Nothing of it is registered in a build.

```ts
export default defineNuxtConfig({
  pglite: {
    devtools: {
      enabled: true, // the tab, when DevTools itself is enabled
      actions: [], // `process` actions, see below
    },
  },
})
```

### Actions

An action is a named operation you run from the tab: seeding, a reset, a migration CLI, a studio. It is defined next to what it needs and runs there; only its `id`, `label` and `description`, and then its result, reach the tab. There are three kinds, by where they run.

**`server`**, in the server config, run against the server instance:

```ts
// server/pglite.config.ts
import { readFile } from 'node:fs/promises'

export default definePGliteServerConfig({
  devtools: {
    actions: [
      {
        id: 'seed',
        label: 'Seed the database',
        description: 'Runs server/database/seed.sql',
        run: async ({ pg }) => {
          await pg.exec(await readFile('server/database/seed.sql', 'utf8'))
        },
      },
    ],
  },
})
```

**`client`**, in the client config, run in the app's tab against its worker instance:

```ts
// app/pglite.config.ts
export default definePGliteClientConfig({
  devtools: {
    actions: [
      {
        id: 'clear',
        label: 'Clear local todos',
        run: async ({ pg }) => (await pg.query('DELETE FROM todos')).affectedRows,
      },
    ],
  },
})
```

**`process`**, in `nuxt.config.ts`, run outside the app with `{ socketUrl, dataDir, startSubprocess, terminal, logger }`: the place for CLIs and tools that reach the database through the socket URL, as any Postgres client would. `startSubprocess` streams the command's output to a terminal in DevTools:

```ts
import type { PGliteProcessAction } from 'nuxt-pglite'

const migrate: PGliteProcessAction = {
  id: 'migrate',
  label: 'Run migrations',
  run: ({ socketUrl, startSubprocess }) => {
    startSubprocess(
      { command: 'pnpm', args: ['exec', 'some-cli', 'migrate'], env: { DATABASE_URL: socketUrl } },
      { id: 'migrate', name: 'Migrations' },
    )
  },
}

export default defineNuxtConfig({
  pglite: { devtools: { actions: [migrate] } },
})
```

Other modules add `process` actions through a hook, called once every module is set up:

```ts
nuxt.hook('pglite:devtools:actions', (actions) => {
  actions.push({ id: 'my-module:studio', label: 'Open the studio', run: () => {} })
})
```

Ids are unique per kind. A `run` may return a value, shown in the tab once reduced to JSON, or throw, shown as the error. `server` and `client` actions are typed from their config, so `pg` carries your extensions; annotate an action written on its own with `PGliteServerAction` or `PGliteClientAction`.

While the development socket runs, `server` actions and the SQL box run against the instance the socket serves, queued like any other client's statements. Without the socket they run in Nitro through `usePGlite()`.

### Terminal

The socket's startup shows as a task in the `nuxt dev` UI. When that UI runs (it does not after a restart into a forked process) and there are `server` or `process` actions, calling the `pglite:devtools:prompt` hook opens a picker in the terminal; the chosen action runs as a task that ends with its result, as runs from the tab do for `process` actions. The UI has no way for a module to add a key of its own, so something has to call the hook, e.g. another module.

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
