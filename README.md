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

The framework-agnostic parts ship as their own entries: `nuxt-pglite/core` (config helper + lazy provider), `nuxt-pglite/socket` (the wire-protocol server), `nuxt-pglite/migrations` (an SQL migrations applier) and `nuxt-pglite/testing` (test databases from your config, with vitest helpers in `nuxt-pglite/testing/vitest`), usable from any Node server or test runner.

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

While `nuxt dev` runs, the module creates the configured instance and serves it over TCP, so anything that speaks Postgres connects to it as it would to a normal server. The URL is logged, set as `DATABASE_URL` if that variable is unset (see [Environment variables](#environment-variables)), and available as `useRuntimeConfig().pglite.url`.

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

Options: `host`, `port`, `path` (a directory for a Unix socket), `env`, `provider`, `maxConnections`, `idleInTransactionTimeout`.

### Environment variables

`socket.env` decides what the socket exports: a name for the URL (`'DATABASE_URL'`, the default), `false` for nothing, or a map whose values are functions of the URL or strings exported as is:

```ts
socket: {
  env: {
    DATABASE_URL: (url) => url,
    DATABASE_POOL_URL: (url) => `${url}?pool=true`,
    DB_DRIVER: 'pg',
  },
}
```

`socket.provider` exports what a hosting provider sets for its database instead, so code written for it reaches the socket unchanged; `env` is merged over it. `netlify` exports `NETLIFY_DB_URL` and `NETLIFY_DB_DRIVER=server` (the `pg` driver of `@netlify/database`, rather than its serverless one) and no `DATABASE_URL`, which Netlify does not set in production.

Each variable is set only when still unset, so a real database configured in the environment wins. Once the dev server is up, a warning names each variable that does not hold the socket's value, set before the module or overwritten after it, e.g. by another module's database emulation, which you then disable. The variables exported are listed when the socket starts, in the DevTools tab, and passed to `process` actions as `env`.

### When `init` fails

The instance is created, and `init` (migrations, seeding) run, when `nuxt dev` starts. If either fails, the dev server keeps running: the error is logged, the socket listens at its usual URL with its variables exported, and every client is refused with a FATAL `57P03` (`cannot_connect_now`) error, `PGlite is not ready: <the error>`, whose hint points at the fix. The DevTools tab shows the reason. Restart `nuxt dev` once the cause is fixed (a change to the config file restarts it), or run the `reset-database` action below to start from an empty database.

PGlite allows one instance per data directory, so `usePGlite()` in your routes refuses the directory the socket serves; connect through the URL instead, or give the server instance another `dataDir`. Tested with `pg`, postgres.js, `psql` and `drizzle-kit push`, on Node, Bun and Deno. One client owns the database at a time for the length of a transaction or pipeline, others queue; the process's own `db.query()` / `db.transaction()` calls queue the same way, so neither side's statements land inside the other's transaction. An owner that stays idle inside a transaction or pipeline past `idleInTransactionTimeout` is disconnected. Notifications reach the clients that ran `LISTEN` on the channel, and a client's settings, temp tables, advisory locks and subscriptions are dropped when it disconnects, as a real server would; the settings the process set before the server started are kept.

Known differences from a real server, inherent to one shared session: `COPY … FROM STDIN` is refused (`0A000`, PGlite cannot run it); `LISTEN`/`UNLISTEN` and SQL-level `PREPARE` / `EXECUTE` / `DEALLOCATE` are recognised as single statements, the way drivers send them, and `LISTEN` takes effect regardless of the transaction it ran in; temp tables and advisory locks taken by the process itself are released when any client disconnects.

## Migrations

Some platforms apply the SQL migrations committed with the app themselves: Netlify Database runs the files in `netlify/database/migrations` at deploy time. `nuxt-pglite/migrations` applies the same files to the local database, with the same bookkeeping (each migration in its own transaction, recorded in `netlify.migrations`), so the local schema comes from the files the deployed one will:

```ts
// server/pglite.config.ts
import { applyMigrations } from 'nuxt-pglite/migrations'

export default definePGliteServerConfig({
  init: (pg) => applyMigrations(pg, 'netlify/database/migrations'),
})
```

`init` runs once per created instance, the socket's included, so the database is brought up to the files before anything queries it. The directory is resolved from `process.cwd()`. With the in-process server (`server.enabled`), `init` also runs in the built app, where the files are not shipped: keep it under `$development` there, or pass an absolute path to a directory that exists at runtime.

A migration is either a `<name>/migration.sql` directory, the layout drizzle-kit 1.0 generates (`<timestamp>_<name>/migration.sql`), or a flat `<name>.sql` file. Anything else in the directory is ignored, and migrations apply in name order. Options: `table` (the tracking table, `schema.table` or `table`, default `netlify.migrations`), `target` (stop at a migration, by full name or by the part before an `_`), `digests` (see below), `logger` (`{ info, warn }`, e.g. `consola`; silent by default). `readMigrations(dir)` lists the migrations as `applyMigrations` sees them, for tooling.

A failing migration throws a `MigrationError` (with the `migration` name and the database error as `cause`) once its transaction is rolled back; the migrations after it are not run. A migration that issues its own `BEGIN; … COMMIT;` commits outside that transaction, so a failure after its `COMMIT` leaves it applied but untracked.

Appliers running at once on the same database (two dev servers, a CI job, …) take turns: each migration's transaction holds a Postgres advisory lock and skips a migration another applier recorded meanwhile.

### Edited migrations

Applied migrations never run again, so a file edited or removed after it was applied (e.g. `drizzle-kit generate` rewriting the last migration while the schema is still in flux) leaves the local database built from files the deployed one will never see. `applyMigrations` records the sha256 digest of each migration it applies (in `nuxt_pglite.migration_digest`) and, before applying anything, checks the applied ones against their files: any `edited` or `removed` throws a `MigrationDriftError` listing them in `details`. The remedy is to reset the local database and let `init` apply the current files from scratch; the DevTools tab has a `reset-database` action for it. Migrations applied before digests were recorded get theirs recorded as their files are now. `digests: false` disables the check, a string names another table.

### Against Postgres

Any database with `exec`, `query` and `transaction` works, PGlite as is. `fromPool` adapts a `pg` pool, e.g. to apply the same files to a real Postgres in CI:

```ts
import { Pool } from 'pg'
import { applyMigrations, fromPool } from 'nuxt-pglite/migrations'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  console.log(await applyMigrations(fromPool(pool), 'netlify/database/migrations'))
} finally {
  await pool.end()
}
```

## Testing

`nuxt-pglite/testing` gives a test suite (vitest, `@nuxt/test-utils`, any runner) a PGlite database built from the app's own server config, `init` included, so tests run against the schema the app sees, without touching its data:

```ts
import { createTestDatabase } from 'nuxt-pglite/testing'

const db = await createTestDatabase({ config: 'server/pglite.config' })
await db.pg.query('INSERT INTO todos (title) VALUES ($1)', ['first'])
// ...
await db.close()
```

Options: `config` (the config object, or the path of its file), `alias` (for a config path, see [Config files](#config-files)), `dataDir` (in memory by default, whatever the config says; the config's `fs` is dropped too), `socket`, `exportEnv`. `$test` overrides in the config apply. `close()` runs the config's `dispose` and closes everything the database opened.

### Isolation

`db.fork()` returns a fresh in-memory copy of the database's current state, with the same extensions and without running `init` again: seed once, then fork per test so that each starts from the same data and none sees another's writes. A fork closes independently; closing its parent closes the forks still open.

```ts
let db: TestDatabase
let test: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase({ config: 'server/pglite.config' })
  await db.pg.exec(seed)
})
beforeEach(async () => {
  test = await db.fork()
})
afterEach(() => test.close())
afterAll(() => db.close())
```

### Through the socket

Code that connects through a URL, rather than receiving `pg`, gets the database over the Postgres wire protocol with `socket`: `true` for a free loopback port, or the module's `socket` options (`port`, `env`, `provider`, ...). `db.url` is the connection URL and `db.env` the variables the socket resolves, as in `nuxt dev`: `DATABASE_URL` by default, `NETLIFY_DB_URL` and `NETLIFY_DB_DRIVER` with `provider: 'netlify'`. They are set on `process.env` while the database is open, only those still unset, unless `exportEnv: false`, and unset on `close()`. A fork has its own socket, on a free port, but exports nothing: pass its `env` on.

```ts
const db = await createTestDatabase({ config: 'server/pglite.config', socket: true })
// process.env.DATABASE_URL === db.url
```

### Config files

`createTestDatabase` loads a config path with `loadPGliteConfig(path)`, also exported: relative to `process.cwd()`, extension optional, with `definePGliteServerConfig` provided as a global while the file is imported (so a file written for the auto-import works unchanged) and `$test` applied. The file is imported through jiti, so TypeScript works on any runtime, and fresh on every call.

Outside Nuxt the app's aliases (`~~`, `#pglite/migrations`, …) are not defined, so a file importing through one fails to load. Pass them as `alias`, to `createTestDatabase`, `definePGliteGlobalSetup` or `loadPGliteConfig`: name to absolute path, as `nuxt.options.alias` holds them. For instance `#pglite/migrations` is the module's `dist/runtime/migrations`, and the `paths` of `.nuxt/tsconfig.json` list the others; or import from `nuxt-pglite/migrations` in the file instead, which resolves anywhere.

```ts
import { fileURLToPath } from 'node:url'

const db = await createTestDatabase({
  config: 'server/pglite.config',
  alias: {
    '#pglite/migrations': fileURLToPath(import.meta.resolve('nuxt-pglite/migrations')),
  },
})
```

### vitest

`nuxt-pglite/testing/vitest` turns this into a `globalSetup` file: one database for the whole run, created before the workers start, served over the socket and closed once the run ends. The workers inherit its variables, and it is provided as `pglite`:

```ts
// test/pglite.setup.ts
import { definePGliteGlobalSetup } from 'nuxt-pglite/testing/vitest'

export default definePGliteGlobalSetup({
  config: 'server/pglite.config',
  socket: { provider: 'netlify' }, // or `true` (the default) for DATABASE_URL
})
```

```ts
// vitest.config.ts
export default defineConfig({
  test: { globalSetup: ['test/pglite.setup.ts'] },
})
```

```ts
// in a test file
import { inject } from 'vitest'

const { url, env } = inject('pglite')
```

The workers share one database, so tests that write to it should run in sequence or clean up after themselves; for isolation per test, use `createTestDatabase` and `fork()` in the test files instead.

### `@nuxt/test-utils`

An end-to-end suite boots the built app in its own process: create the database before `setup()` and hand it the variables, so that the app's code reading `DATABASE_URL` reaches it:

```ts
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { createTestDatabase } from 'nuxt-pglite/testing'

describe('todos', async () => {
  const db = await createTestDatabase({ config: 'server/pglite.config', socket: true })
  afterAll(() => db.close())

  await setup({ env: db.env })

  it('lists the todos', async () => {
    await db.pg.query("INSERT INTO todos (title) VALUES ('first')")
    expect(await $fetch('/api/todos')).toEqual([{ id: 1, title: 'first' }])
  })
})
```

`afterAll` is registered before `setup()`'s own, so it runs after the app is stopped. This fits an app whose database code reads the URL, e.g. with the server side disabled and the development socket on ([PGlite in development only](#pglite-in-development-only)); `usePGlite()` in the built app creates its own instance instead.

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

**`process`**, in `nuxt.config.ts`, run outside the app with `{ socketUrl, env, dataDir, startSubprocess, terminal, logger }`: the place for CLIs and tools that reach the database through the socket URL, as any Postgres client would. `env` holds the variables the socket exported, to pass on. `startSubprocess` streams the command's output to a terminal in DevTools:

```ts
import type { PGliteProcessAction } from 'nuxt-pglite'

const migrate: PGliteProcessAction = {
  id: 'migrate',
  label: 'Run migrations',
  run: ({ env, startSubprocess }) => {
    startSubprocess(
      { command: 'pnpm', args: ['exec', 'some-cli', 'migrate'], env },
      { id: 'migrate', name: 'Migrations' },
    )
  },
}

export default defineNuxtConfig({
  pglite: { devtools: { actions: [migrate] } },
})
```

While the socket runs, the module adds one of its own, **Reset database** (`reset-database`): it closes the socket's instance, deletes its data directory, creates it again (`init` included) and serves it behind the same URL, so the variables stay valid; connected clients are disconnected. A failed reset leaves the socket refusing clients with the new reason. An in-memory database is recreated; a directory that does not look like PGlite's is refused. It acts on the socket's instance only: one created by `usePGlite()` in Nitro is not affected.

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

`server.refuse(reason, { hint })` disconnects the clients and refuses new ones (`57P03`, `PGlite is not ready: <reason>`) while the instance is unavailable; `server.serve(db)` serves an instance from then on, behind the same URL. `createPGliteSocketServer(null)` starts refusing until the first `serve()`.

These entries import only `@electric-sql/pglite` and Node built-ins, `nuxt-pglite/testing` also `jiti` (to load config files), and `nuxt-pglite/migrations` only Node built-ins.

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

The suite also runs against the Nuxt 5 nightly, locally only until Nuxt 5 reaches a release candidate. Append the overrides to `pnpm-workspace.yaml`, install without the frozen lockfile, run the checks, then revert both files:

```yaml
overrides:
  nuxt: npm:nuxt-nightly@5x
  '@nuxt/kit': npm:@nuxt/kit-nightly@5x
  '@nuxt/schema': npm:@nuxt/schema-nightly@5x
```

```bash
pnpm install --no-frozen-lockfile && pnpm typecheck && pnpm test
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
