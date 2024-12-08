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
> This is an highly experimental project. No docs are available (although planned), please refer to the [playground code](/playground).

## Features

<!-- Highlight some of the features your module provide here -->
- 🧑‍💻 &nbsp;Client side `usePGlite`, running inside Web Workers.
- ⚡️ &nbsp;Server side `usePGlite`, running in your Node or Bun server.

## Quick Setup

Install the module to your Nuxt application with one command:

```bash
npx nuxi module add nuxt-pglite
```

That's it! You can now use Nuxt PGlite in your Nuxt app ✨

### Persisten Storage

You can set where to store data in your `nuxt.config.ts`:

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
        dataDir: './database/pglite',
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

For a full list of available extensions please refer to [the official docs](https://pglite.dev/extensions). If a new extension is missing feel free to open up a new PR by adding it to [this file](/src/templates.ts#L62-L87), (I do plan to support only official and contrib).

> [!WARNING]  
> Auto configuration for server-side extensions is currently not supported, the simplest approach is to create a wrapper util like `/server/utils/db.ts`:
> ```ts
> import { vector } from '@electric-sql/pglite/vector'
>
> export function useDB() {
>   return usePGlite({ vector })
> }
> ```

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
