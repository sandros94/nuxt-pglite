<template>
  <div>
    <ul>
      <li>
        <NuxtLink to="/"> Home </NuxtLink>
      </li>
    </ul>
    <div style="display: inline-flex; gap: 0.5rem">
      <button @click.prevent="resetAndQuery()">Reset DB</button>
      <button @click.prevent="insertAndQuery()">Insert</button>
    </div>
    <pre v-if="data">
      {{ data }}
    </pre>
    <p v-else>Loading...</p>
  </div>
</template>

<script setup lang="ts">
const { data, refresh: query } = await useFetch('/api/read')

async function resetAndQuery() {
  await $fetch('/api/reset', { method: 'POST' })
  await query()
}
async function insertAndQuery() {
  await $fetch('/api/insert', { method: 'POST' })
  await query()
}
</script>
