// The auto-imported helper, as an app writes it: `loadPGliteConfig` provides
// it as a global when the file is loaded outside Nuxt.
export default definePGliteServerConfig({
  init: async (pg) => {
    await pg.exec('CREATE TABLE IF NOT EXISTS items (id serial PRIMARY KEY, name text NOT NULL)')
  },
})
