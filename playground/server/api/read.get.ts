export default eventHandler((_event) => {
  const { pg } = usePGlite({
    dataDir: './playground/server/database/pglite-db',
    debug: 1,
  })

  return pg.query('SELECT * FROM test')
})
