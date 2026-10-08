---
seo:
  title: Nuxt PGlite
  description: Embedded Postgres for Nuxt. A PGlite instance for your server routes, a development socket for your Postgres tooling, and an in-browser database with live queries.
---

::u-page-hero{class="dark:bg-gradient-to-b from-neutral-900 to-neutral-950"}
---
orientation: horizontal
---
#top
:hero-background

#title
Postgres in your [Nuxt app]{.text-primary}, no server to run.

#description
Nuxt PGlite wires [PGlite](https://pglite.dev), Postgres compiled to WebAssembly, into Nuxt: an instance for your server routes, the same database over a Postgres URL while `nuxt dev` runs, and an in-browser database with live queries.

#links
  :::u-button
  ---
  to: /guide
  size: xl
  trailing-icon: i-lucide-arrow-right
  ---
  Get started
  :::

  :::u-button
  ---
  icon: i-simple-icons-github
  color: neutral
  variant: outline
  size: xl
  to: https://github.com/sandros94/nuxt-pglite
  target: _blank
  ---
  Star on GitHub
  :::

#default
  :::prose-pre
  ---
  code: |
    export default defineNuxtConfig({
      modules: ['nuxt-pglite'],
      pglite: {
        server: {
          // a Postgres URL while `nuxt dev` runs
          socket: { port: 5433 },
        },
        client: { enabled: true },
      },
    })
  filename: nuxt.config.ts
  ---

  ```ts [nuxt.config.ts]
  export default defineNuxtConfig({
    modules: ['nuxt-pglite'],
    pglite: {
      server: {
        // a Postgres URL while `nuxt dev` runs
        socket: { port: 5433 },
      },
      client: { enabled: true },
    },
  })
  ```
  :::
::

::u-page-section{class="dark:bg-neutral-950"}
#title
Three pieces, use any of them

#features
  :::u-page-feature
  ---
  icon: i-lucide-server
  to: /guide/server
  ---
  #title
  Server instance

  #description
  `usePGlite()` in your Nitro routes: a lazily created PGlite, configured in `server/pglite.config.ts`, typed from its extensions.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-plug
  to: /guide/socket
  ---
  #title
  Development socket

  #description
  The same database over the Postgres wire protocol in `nuxt dev`. `pg`, postgres.js, Drizzle, `drizzle-kit` and `psql` connect through `DATABASE_URL`.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-monitor-smartphone
  to: /guide/client
  ---
  #title
  In-browser database

  #description
  PGlite in a Web Worker shared between tabs, with `useLiveQuery()` keeping your components in sync with the data.
  :::
::

::u-page-section{class="dark:bg-neutral-950"}
#title
And what goes with them

#features
  :::u-page-feature
  ---
  icon: i-lucide-cloud-upload
  to: /recipes/deploy
  ---
  #title
  PGlite in dev, Postgres in prod

  #description
  Develop against PGlite with no database to install, deploy against any Postgres with the same driver code and nothing of PGlite in the build.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-database-backup
  to: /recipes/migrations
  ---
  #title
  Migrations

  #description
  A folder of SQL files, applied from `init` in development and by you or your platform in production.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-test-tube
  to: /recipes/testing
  ---
  #title
  Testing

  #description
  A database built from your app's config for the test suite, in memory and forkable per test.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-wrench
  to: /guide/devtools
  ---
  #title
  DevTools tab

  #description
  Inspect each instance, run SQL against it and trigger your own actions: seeding, resets, migration CLIs.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-package
  to: /recipes/outside-nuxt
  ---
  #title
  Outside Nuxt

  #description
  The config helper, the lazy provider and the socket server ship as their own entries, usable from any Node, Bun or Deno server.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-code-xml
  to: /reference/config-files
  ---
  #title
  Reference

  #description
  Every option, export, hook and environment variable, with its type and default.
  :::
::
