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
- ⚡️&nbsp;Server-side `usePGlite`, running in your Node, Bun or Deno servers.
- 🧑‍💻&nbsp;Client-side `usePGlite`, running inside Web Workers.
- 🪢&nbsp;Client-side `useLiveQuery` and `useLiveIncrementalQuery` to subscribe to live changes.

## Quick Setup

Install the module to your Nuxt application with one command:

```bash
npx nuxi module add nuxt-pglite
```

That's it! You can now use Nuxt PGlite in your Nuxt app ✨

### Storage

You can configure where to store data in your `nuxt.config.ts`. Server-side storage accepts relative baths based on `rootDir` (`~~`):

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
        dataDir: '.data/pglite', // will use `~~/.data/pglite`
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

## Live Queries

With Live Queries we can subscrive to events happening in the database and reactively update the user interface. This becomes particularly usefuly client-side thanks to Web Workers, allowing us to keep content in sync even when the user opens up multiple tabs.

To get started simply add `live` extension to your `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-pglite'],

  pglite: {
    client: {
      extensions: [
        // ...
        'live',
      ],
    },
  },
})
```

This will enable auto-import for `useLiveQuery` and `useLiveIncrementalQuery`. The quick implementation would be:

```vue
<script setup lang="ts">
const maxNumber = ref(100)
const items = useLiveQuery.sql`
  SELECT *
  FROM my_table
  WHERE number <= ${maxNumber.value}
  ORDER BY number;
`
</script>
```

Live queries are currently a custom fork of the upstream implementation, which you can read more [here](https://pglite.dev/docs/framework-hooks/vue#uselivequery).

## Hooks

We can use hooks to customize or extend PGlite at runtime. This becomes particularly useful in conjunction with [`RLS`](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) or adding custom extensions server-side.

### RLS

PGlite supports RLS out of the box, but being a single-user/single-connection database it is more frequent to be used only client side. Lets take in example a basic implementation with `nuxt-auth-utils`. We'll need to create a client-only Nuxt plugin `/plugins/rls.client.ts`:

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

This, in combination with [`Sync`](https://pglite.dev/docs/sync), will make us able to create an offline-first application with the ability for the users to save their data in a centralized postgres instance.

### Customizing extensions

We can also use hooks to pass custom options to extensions like [`Sync`](https://pglite.dev/docs/sync) as well as improve typing for the whole project.

In the following example we are creating a `/server/plugins/extend-pglite.ts` plugin that adds and configure `pgvector` and `Sync`:

```ts
import { vector } from '@electric-sql/pglite/vector'
import { electricSync } from '@electric-sql/pglite-sync'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('pglite:config', (options) => {
    options.extensions = {
      vector,
      electric: electricSync({
        metadataSchema: 'my-electric',
      }),
    }
  })

  nitro.hooks.hook('pglite:init', async (pg) => {
    await pg.query('CREATE EXTENSION IF NOT EXISTS vector;')
  })
})

// Improve typing for server-side extensions
declare module '#pglite-utils' {
  interface PGliteServerExtensions {
    vector: typeof vector
    electric: ReturnType<typeof electricSync>
  }
}
```

> [!WARNING]  
> This is currently the only way to type server-side extensions.

### Hooking Notes

A few things to consider are that:
- we rely on `nuxtApp` hooks for client-side, while `nitroApp` for server-side, hooks available are:
  - `pglite:config`: provides access to `PGliteOptions` before initializing a new PGlite instance.
  - `pglite:init`: provides access to the initialized PGlite instance.
- To improve types when manually adding extensions we use `PGliteClientExtensions` and `PGliteServerExtensions` for client and server respectively.

## ORM support

Any ORM that accept a PGlite or PGliteWorker instances should be supported both server and client side.

### Drizzle

Drizzle integration for server-side is as simple as:
```ts
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../my-path-to/schema'

export function useDB() {
  const pg = await usePGlite()
  return drizzle(pg, { schema })
}
```

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
