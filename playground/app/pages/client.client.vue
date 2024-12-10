<template>
  <div>
    <ul>
      <li>
        <NuxtLink to="/">
          Home
        </NuxtLink>
      </li>
    </ul>
    <h2>
      PGlite is {{ db?.ready ? 'ready' : 'not ready' }}
    </h2>
    <button @click="reset()">
      Init DB
    </button>
    <button @click="insert()">
      Insert
    </button>
    <button @click="query()">
      Query
    </button>
    <pre v-if="data">
      {{ data }}
    </pre>
    <p v-else>
      Loading...
    </p>
  </div>
</template>

<script setup lang="ts">
import type { Results } from '@electric-sql/pglite'
import type { LiveQuery } from '@electric-sql/pglite/live'

interface Record {
  id: number
  name: typeof names[number]
}

const names = ['Marco', 'Polo', 'Leonardo', 'Da Vinci', 'Michelangelo', 'Raffaello', 'Donatello'] as const
const data = ref<Results<Record> | undefined>()
let live: LiveQuery<Record> | undefined = undefined

const db = usePGlite()

async function reset() {
  if (live) {
    await live.unsubscribe()
  }
  await db.exec(`
DROP TABLE IF EXISTS test;
CREATE TABLE IF NOT EXISTS test (
  id SERIAL PRIMARY KEY,
  name TEXT
);
`).then(async () => {
    await query()
    subscribe()
  })
}

await query()
  .catch(async () => await reset())
  .then(async () => await subscribe())

async function query() {
  return data.value = await db.query<Record>('SELECT * FROM test')
}

async function subscribe() {
  if (live) return
  live = await db.live.query<Record>('SELECT * FROM test', [], (res) => {
    data.value = res
  })
}
onBeforeRouteLeave(() => {
  if (!live) return
  live.unsubscribe()
})

async function insert() {
  await db
    .query(
      `INSERT INTO test (name) VALUES ($1)`,
      [
        names[Math.floor(Math.random() * names.length)],
      ],
    )
    .then(() => query())
}
</script>
