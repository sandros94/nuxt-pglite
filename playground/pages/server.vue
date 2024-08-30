<template>
  <div>
    <ul>
      <li>
        <NuxtLink to="/">
          Home
        </NuxtLink>
      </li>
    </ul>
    <button @click="init()">
      Init DB
    </button>
    <pre v-if="data">
      {{ data }}
    </pre>
    <p v-else>
      Loading...
    </p>
    <button @click="insert(); query()">
      Insert
    </button>
    <button @click="query()">
      Query
    </button>
    <pre v-if="test">
      {{ test.rows }}
    </pre>
    <p v-else>
      Query not run yet
    </p>
  </div>
</template>

<script setup lang="ts">
import type { Results } from '@electric-sql/pglite'

const test = ref<Results | undefined>()

const { execute: init } = await useFetch('/api/init', {
  method: 'POST',
  immediate: false,
})
const { data, refresh: query } = await useFetch('/api/read')
const { execute: insert } = await useFetch('/api/insert', {
  method: 'POST',
  immediate: false,
})
</script>
