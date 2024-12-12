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
    <button @click="clear()">
      Delete Data
    </button>
    <button @click="insert()">
      Insert
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
interface Record {
  id: number
  name: typeof names[number]
}

const names = ['Buonarroti', 'Da Vinci', 'di Niccolò di Betto Bardi', 'Sanzio'] as const
const data = useLiveQuery<Record>('SELECT * FROM test;')

const db = usePGlite()

async function insert() {
  await db
    .query(
      `INSERT INTO test (name) VALUES ($1);`,
      [
        names[Math.floor(Math.random() * names.length)],
      ],
    )
}

async function clear() {
  await db
    .query('DELETE FROM test;')
}

await callOnce('pglite:db:init', async () => {
  await db.exec(`CREATE TABLE IF NOT EXISTS test (
  id SERIAL PRIMARY KEY,
  name TEXT
);`)
})
</script>
