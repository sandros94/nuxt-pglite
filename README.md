<!--
Get your module up and running quickly.

Find and replace all on all files (CMD+SHIFT+F):
- Name: Nuxt PGlite
- Package name: nuxt-pglite
- Description: A Nuxt module aimed to simplify the use of PGlite.
-->

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

## Features

<!-- Highlight some of the features your module provide here -->
- 🧑‍💻 &nbsp;Client side `usePGlite`, running in the JS main thread.
- 🖥️ &nbsp;Client side `usePGliteWorker`, running inside Web Workers.
- ⚡️ &nbsp;Server side `usePGlite`, running in your Node or Bun server.

## Quick Setup

Install the module to your Nuxt application with one command:

```bash
npx nuxi module add nuxt-pglite
```

That's it! You can now use Nuxt PGlite in your Nuxt app ✨


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
