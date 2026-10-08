# nuxt-pglite

[![npm version](https://npmx.dev/api/registry/badge/version/nuxt-pglite?name=true)](https://npmx.dev/package/nuxt-pglite) [![npm downloads](https://npmx.dev/api/registry/badge/downloads/nuxt-pglite)](https://npmx.dev/package/nuxt-pglite) [![bundle size](https://npmx.dev/api/registry/badge/size/nuxt-pglite)](https://npmx.dev/package/nuxt-pglite) [![Netlify Status](https://api.netlify.com/api/v1/badges/d0b05a02-7539-41e9-b3c4-dbac0fcfba80/deploy-status)](https://app.netlify.com/projects/nuxt-pglite/deploys)

[PGlite](https://pglite.dev) tooling for Nuxt. A Postgres you don't run in development, swapped for a real one in production without touching your code; an embedded one on the server or in the browser when it is needed.

> **📖 Documentation — [nuxt-pglite.s94.dev](https://nuxt-pglite.s94.dev)**

## Features

- **Server** — a lazily created PGlite instance for your Nitro routes (`usePGlite()`), configured in `server/pglite.config.ts` with your own extensions and `init`.
- **Development socket** — that instance served over the Postgres wire protocol while `nuxt dev` runs. `pg`, postgres.js, Drizzle, Kysely, `drizzle-kit`, `psql` reach it through `DATABASE_URL` (or a provider's variables), exactly as they reach Postgres in production. With the server side off, nothing of PGlite reaches the build.
- **Client** — an in-browser PGlite in a Web Worker shared between tabs, with live-query composables, configured in `app/pglite.config.ts`. Off by default.
- **Migrations** — `nuxt-pglite/migrations` applies a folder of SQL files from `init`, with the bookkeeping platforms such as Netlify Database use on deploy, and refuses files edited after they ran.
- **Testing** — `nuxt-pglite/testing` builds databases from your config, forks them per test, serves them over the socket; `nuxt-pglite/testing/vitest` wires one per run.
- **DevTools** — a tab with an SQL editor and actions that run on the server, in the browser or next to the socket (seed, reset, `drizzle-kit`…).
- **Nuxt 4 and 5** (Nitro 2 and 3), Node, Bun and Deno; `@electric-sql/pglite` as a peer dependency, so you pick the version and the types follow your config.

## Install

```sh
npx nuxi module add nuxt-pglite
npx nypm install @electric-sql/pglite
```

## Quickstart

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

PGlite in development only, a real Postgres in production:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-pglite'],
  pglite: {
    server: { enabled: false },
    socket: true, // exports DATABASE_URL while `nuxt dev` runs
  },
})
```

```ts
// server/pglite.config.ts
import { applyMigrations } from 'nuxt-pglite/migrations'

export default definePGliteServerConfig({
  init: (pg) => applyMigrations(pg, 'server/database/migrations'),
})
```

Guides, recipes and the reference live at **[nuxt-pglite.s94.dev](https://nuxt-pglite.s94.dev)**:

- [Getting started →](https://nuxt-pglite.s94.dev/guide)
- [Server →](https://nuxt-pglite.s94.dev/guide/server)
- [Development socket →](https://nuxt-pglite.s94.dev/guide/socket)
- [Client →](https://nuxt-pglite.s94.dev/guide/client)
- [DevTools →](https://nuxt-pglite.s94.dev/guide/devtools)
- [Migrations →](https://nuxt-pglite.s94.dev/recipes/migrations)
- [Testing →](https://nuxt-pglite.s94.dev/recipes/testing)
- [Deploy →](https://nuxt-pglite.s94.dev/recipes/deploy) — any Postgres, Netlify Database, Neon.
- [Reference →](https://nuxt-pglite.s94.dev/reference/config-files) — config files, module and socket options, exports, hooks, environment.

## Development

<details>

<summary>local development</summary>

- Clone this repository
- Install latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install` (stubs `dist/`, prepares the playground and the docs)
- Develop with `pnpm dev` (playground) or `pnpm run docs` (documentation site)
- Run tests using `pnpm test`; `pnpm lint`, `pnpm fmt` and `pnpm typecheck` for the rest
- Build with `pnpm build`; `pnpm dev:prepare` restores the stub afterwards

The suite also runs against the Nuxt 5 nightly, locally only until Nuxt 5 reaches a release candidate. Append the overrides to `pnpm-workspace.yaml`, install without the frozen lockfile, run the checks, then revert both files:

```yaml
overrides:
  nuxt: npm:nuxt-nightly@5x
  '@nuxt/kit': npm:@nuxt/kit-nightly@5x
  '@nuxt/schema': npm:@nuxt/schema-nightly@5x
```

```sh
pnpm install --no-frozen-lockfile && pnpm typecheck && pnpm test
```

</details>

## License

<!-- automd:contributors license=MIT -->

Published under the [MIT](https://github.com/sandros94/nuxt-pglite/blob/main/LICENSE) license. Made by [community](https://github.com/sandros94/nuxt-pglite/graphs/contributors) 💛 <br><br> <a href="https://github.com/sandros94/nuxt-pglite/graphs/contributors"> <img src="https://contrib.rocks/image?repo=sandros94/nuxt-pglite" /> </a>

<!-- /automd -->

<!-- automd:with-automd -->

---

_🤖 auto updated with [automd](https://automd.unjs.io)_

<!-- /automd -->
