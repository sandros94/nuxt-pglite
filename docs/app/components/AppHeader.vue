<script setup lang="ts">
const { header } = useAppConfig()
const { area, links } = useDocsAreas()
</script>

<template>
  <UHeader>
    <template #left>
      <NuxtLink
        :to="header?.to || '/'"
        class="focus-visible:outline-3 outline-primary/25 rounded-md p-1 -ms-1"
      >
        <AppLogo class="shrink-0" />
      </NuxtLink>
    </template>

    <UNavigationMenu :items="links" variant="link" />

    <template #right>
      <UTooltip text="Search" :kbds="['meta', 'K']" ignore-non-keyboard-focus>
        <UContentSearchButton />
      </UTooltip>

      <template v-if="header?.links">
        <UButton
          v-for="(link, index) of header.links"
          :key="index"
          v-bind="{ color: 'neutral', variant: 'ghost', ...link }"
        />
      </template>
    </template>

    <template #body>
      <UNavigationMenu :items="links" orientation="vertical" class="-mx-2.5" />

      <template v-if="area?.children?.length">
        <USeparator type="dashed" class="my-4" />

        <UContentNavigation highlight :navigation="area.children" />
      </template>
    </template>
  </UHeader>
</template>
