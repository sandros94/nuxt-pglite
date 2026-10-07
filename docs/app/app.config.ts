export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'slate',
    },
    footer: {
      slots: {
        root: 'border-t border-default',
        left: 'text-sm text-muted',
      },
    },
  },
  seo: {
    siteName: 'Nuxt PGlite',
  },
  header: {
    title: '',
    to: '/',
    logo: {
      alt: '',
      light: '',
      dark: '',
    },
    search: true,
    colorMode: true,
    links: [
      {
        'icon': 'i-simple-icons-npm',
        'to': 'https://npmjs.com/package/nuxt-pglite',
        'target': '_blank',
        'aria-label': 'nuxt-pglite on npm',
      },
      {
        'icon': 'i-simple-icons-github',
        'to': 'https://github.com/sandros94/nuxt-pglite',
        'target': '_blank',
        'aria-label': 'GitHub',
      },
    ],
  },
  footer: {
    credits: `Published under the MIT license • © ${new Date().getFullYear()} Sandro Circi`,
    colorMode: false,
    links: [
      {
        'icon': 'i-simple-icons-github',
        'to': 'https://github.com/sandros94/nuxt-pglite',
        'target': '_blank',
        'aria-label': 'Nuxt PGlite on GitHub',
      },
    ],
  },
  toc: {
    title: 'On this page',
    bottom: {
      title: 'Links',
      edit: 'https://github.com/sandros94/nuxt-pglite/edit/main/docs/content',
      links: [
        {
          icon: 'i-lucide-star',
          label: 'Star on GitHub',
          to: 'https://github.com/sandros94/nuxt-pglite',
          target: '_blank',
        },
        {
          icon: 'i-lucide-book-open',
          label: 'PGlite docs',
          to: 'https://pglite.dev/docs/',
          target: '_blank',
        },
      ],
    },
  },
})
