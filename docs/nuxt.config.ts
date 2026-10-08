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

  // No toggle: the site follows the system theme.
  colorMode: {
    preference: 'system',
  },

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
        title: 'Guide',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/guide%' }],
      },
      {
        title: 'Recipes',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/recipes%' }],
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

  routeRules: {
    // The areas without an index page open on their first page.
    '/recipes': { redirect: '/recipes/migrations' },
    '/reference': { redirect: '/reference/config-files' },
  },

  prerender: {
    routes: ['/'],
    crawlLinks: true,
  },
})
