import type { PGliteProcessAction } from 'nuxt-pglite'

/** Opens Drizzle Studio on the development socket, in a DevTools terminal. */
const studio: PGliteProcessAction = {
  id: 'drizzle-studio',
  label: 'Open Drizzle Studio',
  description: 'Runs `drizzle-kit studio` against the development socket',
  run: ({ socketUrl, startSubprocess }) => {
    if (!socketUrl) {
      throw new Error('The development socket is not running.')
    }
    // `drizzle.config.ts` points at the pinned socket port, so no variable to pass.
    startSubprocess(
      { command: 'pnpm', args: ['exec', 'drizzle-kit', 'studio'] },
      { id: 'drizzle-studio', name: 'Drizzle Studio', icon: 'simple-icons:drizzle' },
    )
    return 'Drizzle Studio is starting, see the DevTools terminal.'
  },
}

export default defineNuxtConfig({
  modules: [
    '@nuxt/image',
    '@nuxt/ui',
    '@nuxt/content',
    'nuxt-og-image',
    'nuxt-llms',
    '@nuxtjs/mcp-toolkit',
    'nuxt-pglite',
  ],

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  site: {
    // Placeholder until the production domain is settled; `NUXT_SITE_URL` overrides it.
    url: 'https://nuxt-pglite.s94.dev',
    name: 'Nuxt PGlite',
  },

  content: {
    build: {
      markdown: {
        toc: {
          searchDepth: 1,
        },
      },
    },
    experimental: {
      sqliteConnector: 'native',
    },
  },

  experimental: {
    asyncContext: true,
  },

  compatibilityDate: '2026-06-30',

  pglite: {
    // The interactive examples run on the in-browser instance (`app/pglite.config.ts`).
    client: {
      enabled: true,
    },
    // No PGlite on the server: the API routes use Netlify Database through
    // `NETLIFY_DB_URL`, which the development socket provides in `nuxt dev`
    // (the `netlify` preset) and Netlify in production.
    server: {
      enabled: false,
      socket: { port: 5456, provider: 'netlify' },
    },
    devtools: {
      actions: [studio],
    },
  },

  llms: {
    domain: 'https://nuxt-pglite.s94.dev',
    title: 'Nuxt PGlite',
    description:
      'A Nuxt module for PGlite: an embedded Postgres on the server, a development socket for your Postgres tooling, and an in-browser database with live queries.',
    full: {
      title: 'Nuxt PGlite - Full Documentation',
      description: 'The full documentation of Nuxt PGlite.',
    },
    sections: [
      {
        title: 'Getting Started',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/getting-started%' }],
      },
      {
        title: 'Server',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/server%' }],
      },
      {
        title: 'Development socket',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/socket%' }],
      },
      {
        title: 'Client',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/client%' }],
      },
      {
        title: 'DevTools & tooling',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/devtools%' }],
      },
      {
        title: 'Migrations',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/migrations%' }],
      },
      {
        title: 'Testing',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/testing%' }],
      },
      {
        title: 'Deploy',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/deploy%' }],
      },
      {
        title: 'Outside Nuxt',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/outside-nuxt%' }],
      },
      {
        title: 'Reference',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/reference%' }],
      },
    ],
  },

  mcp: {
    name: 'Nuxt PGlite',
  },

  ogImage: {
    zeroRuntime: true,
  },

  prerender: {
    routes: ['/'],
    crawlLinks: true,
  },
})
