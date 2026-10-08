import { defineEventHandler } from 'nuxt/server'

import { tables, useDB } from '../utils/db'

export default defineEventHandler(async (_event) => {
  const db = await useDB()

  return db.insert(tables.test).values({
    name: getRandomName(),
  })
})

const getRandomName = () => {
  const names = ['Buonarroti', 'Da Vinci', 'di Niccolò di Betto Bardi', 'Sanzio'] as const
  return names[Math.floor(Math.random() * names.length)]
}
