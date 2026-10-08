<script setup lang="ts">
// Each area (Guide, Recipes, Reference) has its own sidebar: its tree only.
const { area } = useDocsAreas()
</script>

<template>
  <UContainer>
    <UPage>
      <template #left>
        <UPageAside>
          <UContentNavigation highlight :navigation="area?.children" />
        </UPageAside>
      </template>

      <slot />
    </UPage>
  </UContainer>
</template>
