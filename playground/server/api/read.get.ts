export default eventHandler((_event) => {
  const db = useDB()

  return db.select().from(tables.test)
})
