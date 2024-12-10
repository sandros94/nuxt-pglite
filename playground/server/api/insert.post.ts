export default eventHandler((_event) => {
  const db = useDB()

  return db.insert(tables.test).values({
    name: getRandomName(),
  })
})

const getRandomName = () => {
  const names = ['Buonarroti', 'Da Vinci', 'di Niccolò di Betto Bardi', 'Sanzio'] as const
  return names[Math.floor(Math.random() * names.length)]
}
