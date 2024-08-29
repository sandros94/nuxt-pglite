export default eventHandler(async (_event) => {
  const { pg } = usePGlite()

  const test = await pg.query('SELECT * FROM test').catch((e) => {
    console.error(JSON.stringify(e, null, 2))
    return undefined
  })

  if (!test && pg.ready) {
    return await initDb()
  }
  else {
    return test
  }
})
