<template>
  <div>
    <ul>
      <li>
        <NuxtLink to="/">
          Home
        </NuxtLink>
      </li>
    </ul>
    <div style="display: inline-flex; gap: .5rem;">
      <button @click.prevent="reset(); query()">
        Reset DB
      </button>
      <button @click.prevent="insert(); query()">
        Insert
      </button>
    </div>
    <pre v-if="data">
      {{ data }}
    </pre>
    <p v-else>
      Loading...
    </p>
  </div>
</template>

<script setup lang="ts">
const { data, refresh: query } = await useFetch('/api/read')

async function reset() {
  await $fetch('/api/reset', {
    method: 'POST',
  })
}
async function insert() {
  await $fetch('/api/insert', {
    method: 'POST',
  })
}
</script>
