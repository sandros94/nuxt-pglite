export default eventHandler((_event) => {
  const pg = usePGlite()

  return pg.query(`INSERT INTO test (name) VALUES ('test')`)
})
