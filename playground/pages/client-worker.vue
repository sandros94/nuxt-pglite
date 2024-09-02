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
      PGlite is {{ isReady ? 'ready' : 'not ready' }}
    </h2>
    <button @click="init()">
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

const data = ref<Results[] | Results<unknown> | undefined>()

const { pg, isReady } = usePGliteWorker()

async function init() {
  if (!pg.value) {
    console.error('PGlite is not ready')
    return
  }
  await pg.value?.exec(`
CREATE TABLE IF NOT EXISTS test (
  id SERIAL PRIMARY KEY,
  name TEXT
);
INSERT INTO test (name) VALUES ('test');
`)
}

data.value = await pg.value?.query('SELECT * FROM test')

async function query() {
  return data.value = await pg.value?.query('SELECT * FROM test')
}

async function insert() {
  await pg.value?.query(`INSERT INTO test (name) VALUES ('test')`)
}
</script>
