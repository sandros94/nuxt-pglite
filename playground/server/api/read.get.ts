export default eventHandler(async (_event) => {
  const db = await useDB()
  let data: { id: number, name: string | null }[]

  try {
    data = await db.select().from(tables.test)
  }
  catch {
    await db.$client.exec(`CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );`)

    return []
  }

  return data
})
