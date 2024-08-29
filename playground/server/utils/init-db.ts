export async function initDb() {
  const { pg } = usePGlite({
    debug: 1,
  })

  return await pg.exec(`
CREATE TABLE IF NOT EXISTS test (
  id SERIAL PRIMARY KEY,
  name TEXT
);
INSERT INTO test (name) VALUES ('test');
SELECT * FROM test;
  `)
}
