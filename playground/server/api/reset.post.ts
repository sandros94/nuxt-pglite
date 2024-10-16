export default defineEventHandler(async (_event) => {
  return await initDb()
})
