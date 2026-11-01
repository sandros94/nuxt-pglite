<template>
  <main>
    <p v-if="data">Visits: {{ data.total }}</p>
    <p v-else>Loading...</p>
    <button @click.prevent="visit()">Visit</button>
  </main>
</template>

<script setup lang="ts">
const { data, refresh } = await useFetch('/api/visits')

async function visit() {
  await $fetch('/api/visits', { method: 'POST' })
  await refresh()
}
</script>
