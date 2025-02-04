export default defineEventHandler(async (_event) => {
  const db = await useDB()

  return db.delete(tables.test)
})
