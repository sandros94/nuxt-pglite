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
      <button @click="reset(); query()">
        Reset DB
      </button>
      <button @click="insert(); query()">
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
const { execute: reset } = await useFetch('/api/reset', {
  method: 'POST',
  immediate: false,
})
const { data, refresh: query } = await useFetch('/api/read')
const { execute: insert } = await useFetch('/api/insert', {
  method: 'POST',
  immediate: false,
})
</script>
