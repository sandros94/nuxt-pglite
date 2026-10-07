<script setup lang="ts">
const props = withDefaults(defineProps<{ query?: string }>(), {
  query: 'SELECT name, moons, radius_km FROM planets ORDER BY moons DESC;',
})
</script>

<template>
  <div class="not-prose my-5">
    <ClientOnly>
      <PgliteSqlRunner :query="props.query" />
      <template #fallback>
        <USkeleton class="h-64 w-full" />
      </template>
    </ClientOnly>
  </div>
</template>
