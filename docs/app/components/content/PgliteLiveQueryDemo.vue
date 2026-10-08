<template>
  <div class="not-prose my-5 grid gap-4 lg:grid-cols-2">
    <ClientOnly>
      <PgliteTodos />
      <template #fallback>
        <USkeleton class="h-72 w-full" />
      </template>
    </ClientOnly>
    <!-- The code behind the demo, written in the page's markdown. -->
    <div class="min-w-0 [&_pre]:my-0">
      <slot />
    </div>
  </div>
</template>
