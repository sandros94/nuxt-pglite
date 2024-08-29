export default eventHandler((_event) => {
  const { pg } = usePGlite({
    dataDir: './playground/server/database/pglite-db',
    debug: 1,
  })

  return pg.exec(`
CREATE TABLE IF NOT EXISTS test (
  id SERIAL PRIMARY KEY,
  name TEXT
);
INSERT INTO test (name) VALUES ('test');
SELECT * FROM test;
  `)
})
