# Nuxt PGlite

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

A Nuxt module aimed to simplify the use of [PGlite](https://pglite.dev).
> PGlite, an Embeddable Postgres
> Run a full Postgres database locally in WASM with reactivity and live sync.

- [✨ &nbsp;Release Notes](/CHANGELOG.md)
<!-- - [🏀 Online playground](https://stackblitz.com/github/sandros94/nuxt-pglite?file=playground%2Fapp.vue) -->
<!-- - [📖 &nbsp;Documentation](https://example.com) -->

> [!WARNING]  
> No docs are available (although planned), please refer to the [playground code](/playground).

## Features

<!-- Highlight some of the features your module provide here -->
- ⚡️&nbsp;Server-side `usePGlite`, running in your Node or Bun server.
- 🧑‍💻&nbsp;Client-side `usePGlite`, running inside Web Workers.
- 🪢&nbsp;Client-side `useLiveQuery` and `useLiveIncrementalQuery` to subscribe to live changes.

## Quick Setup

Install the module to your Nuxt application with one command:

```bash
npx nuxi module add nuxt-pglite
```

That's it! You can now use Nuxt PGlite in your Nuxt app ✨

### Storage

You can configure where to store data in your `nuxt.config.ts`. Server-side storage accepts relative baths:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-pglite'],

  pglite: {
    client: {
      options: {
        dataDir: 'idb://nuxt-pglite',
      },
    },
    server: {
      options: {
        dataDir: './database/pglite', // will use `~~/server/database/pglite`
      },
    },
  },
})
```

For supported filesystem please refer to the [official documentation](https://pglite.dev/docs/filesystems).

### Extensions

Extensions are automatically configured with full type support and can be added via `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-pglite'],

  pglite: {
    client: {
      extensions: ['live', 'electricSync'],
    },
  },
})
```

For a full list of available extensions please refer to [the official docs](https://pglite.dev/extensions). If a new extension is missing feel free to open up a new PR by adding it to [this file](/src/templates.ts#L62-L87). I do plan to support only official and contrib extensions.

> [!WARNING]  
> Auto configuration for server-side extensions will be supported once Nuxt `v3.15` gets released. See below how to use hooks to add extensions server side.

### Hooks

We can use hooks to customize or extend PGlite at runtime. This becomes particularly useful in conjunction with [`RLS`](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) or adding custom extensions server-side.

#### RLS

Lets take in example a basic implementation with `nuxt-auth-utils`. We'll need to create a client-only Nuxt plugin `/plugins/rls.client.ts`:
```ts
export default defineNuxtPlugin((nuxtApp) => {
  const { user } = useUserSession()

  if (user) {
    nuxtApp.hook('pglite:config', (options) => {
      options.username = user.id
    })
  }
})
```

#### Customizing extensions

We can also use hooks to pass custom options to extensions like [`Sync`](https://pglite.dev/docs/sync) as well as improve typing for the whole project.

In the following example we are creating a `/server/plugins/extend-pglite.ts` plugin that adds and configure `pgvector` and `Sync`:

```ts
import { vector } from '@electric-sql/pglite/vector'
import { electricSync } from '@electric-sql/pglite-sync'

import { pgliteHooks } from '#pglite-utils'

export default defineNitroPlugin(() => {
  pgliteHooks.hook('pglite:config', (options) => {
    options.extensions = {
      vector,
      electric: electricSync({
        metadataSchema: 'my-electric',
      }),
    }
  })

  pgliteHooks.hookOnce('pglite', async (pg) => {
    await pg.query('CREATE EXTENSION IF NOT EXISTS vector;')
  })
})

declare module '#pglite-utils' {
  interface PGliteServerExtensions {
    vector: typeof vector
    electric: ReturnType<typeof electricSync>
  }
}
```

> [!WARNING]  
> Until Nuxt `v3.15` gets released this is the only way to add extensions server-side.

#### Hooking Notes

A few things to consider are that:
- we rely on `nuxtApp` hooks for client-side, while `pgliteHooks` imported from `#pglite-utils` for server-side, hooks available are:
  - `pglite:config`: provides access to `PGliteOptions` before initializing a new PGlite instance.
  - `pglite`: called on every PGlite execution.
- To improve types when manually adding extensions we use `PGliteClientExtensions` and `PGliteServerExtensions` for client and server respectively.

## Contribution

<details>
  <summary>Local development</summary>
  
  ```bash
  # Install dependencies
  pnpm install
  
  # Generate type stubs
  pnpm run dev:prepare
  
  # Develop with the playground
  pnpm run dev
  
  # Build the playground
  pnpm run dev:build
  
  # Run ESLint
  pnpm run lint
  
  # Run Vitest
  pnpm run test
  pnpm run test:watch
  
  # Release new version
  pnpm run release
  ```

</details>


<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-pglite/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/nuxt-pglite

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-pglite.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npmjs.com/package/nuxt-pglite

[license-src]: https://img.shields.io/npm/l/nuxt-pglite.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/nuxt-pglite

[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
