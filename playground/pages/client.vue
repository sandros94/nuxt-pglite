<template>
  <ClientOnly>
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
  </ClientOnly>
</template>

<script setup lang="ts">
import type { Results } from '@electric-sql/pglite'

const name = ['Marco', 'Polo', 'Leonardo', 'Da Vinci', 'Michelangelo', 'Raffaello', 'Donatello']
const data = ref<Results[] | Results<unknown> | undefined>()

const db = usePGlite()

async function reset() {
  await db?.exec(`
DROP TABLE IF EXISTS test;
CREATE TABLE IF NOT EXISTS test (
  id SERIAL PRIMARY KEY,
  name TEXT
);
`).then(() => query())
}

data.value = await db?.query('SELECT * FROM test')

async function query() {
  return data.value = await db?.query('SELECT * FROM test')
}

async function insert() {
  if (!db) return
  await db
    .query(
      `INSERT INTO test (name) VALUES ($1)`,
      [
        name[Math.floor(Math.random() * name.length)],
      ],
    )
    .then(() => query())
}
</script>
