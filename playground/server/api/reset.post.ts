export default defineEventHandler((_event) => {
  const db = useDB()

  return db.delete(tables.test)
})
