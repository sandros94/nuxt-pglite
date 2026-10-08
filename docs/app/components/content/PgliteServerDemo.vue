<template>
  <div class="not-prose my-5">
    <ClientOnly>
      <PgliteVisits />
      <template #fallback>
        <USkeleton class="h-48 w-full" />
      </template>
    </ClientOnly>
  </div>
</template>
