// Read by the development socket only: the server side is disabled, so
// nothing of PGlite reaches the Workers build.
export default definePGliteServerConfig({
  init: (pg) =>
    pg.exec(`
      CREATE TABLE IF NOT EXISTS visits (
        id serial PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `),
})
