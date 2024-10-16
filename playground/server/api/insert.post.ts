export default eventHandler((_event) => {
  const db = useDB()

  return db.insert(tables.test).values({
    name: getRandomName(),
  })
})

const getRandomName = () => {
  const names = ['Bob', 'Jane', 'John', 'Sally', 'Kate', 'Lisa', 'Mary', 'Anna', 'Elizabeth', 'Ashley', 'Sarah']
  return names[Math.floor(Math.random() * names.length)]
}
