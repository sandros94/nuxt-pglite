<script setup lang="ts">
const data = shallowRef<VisitsResponse>()
const loading = ref(false)

async function request(method: 'GET' | 'POST') {
  loading.value = true
  try {
    data.value = await $fetch<VisitsResponse>('/api/visits', { method })
  } catch (cause) {
    data.value = { status: 'error', message: errorMessage(cause) }
  } finally {
    loading.value = false
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}

onMounted(() => request('GET'))
</script>

<template>
  <UCard data-testid="server-demo">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-server" class="size-4" />
          <span><code>/api/visits</code>, Drizzle over <code>DATABASE_URL</code></span>
        </span>
        <div class="flex gap-2">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Reload"
            :loading="loading"
            @click="request('GET')"
          />
          <UButton
            label="Add a visit"
            icon="i-lucide-plus"
            size="sm"
            :loading="loading"
            :disabled="data?.status !== 'ok'"
            data-testid="visit-add"
            @click="request('POST')"
          />
        </div>
      </div>
    </template>

    <USkeleton v-if="!data" class="h-24 w-full" />

    <UAlert
      v-else-if="data.status === 'unconfigured'"
      color="warning"
      variant="subtle"
      icon="i-lucide-database-zap"
      title="No DATABASE_URL"
      :description="data.message"
      data-testid="server-demo-unconfigured"
    />

    <UAlert
      v-else-if="data.status === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      title="The database answered with an error"
      :description="data.message"
    />

    <div v-else data-testid="server-demo-ok">
      <p class="text-sm">
        <span class="font-semibold text-highlighted">{{ data.total }}</span>
        visit(s) recorded. Latest:
      </p>
      <ul class="mt-2 space-y-1 font-mono text-xs text-muted">
        <li v-for="visit in data.latest" :key="visit.id">
          #{{ visit.id }} · {{ formatDate(visit.createdAt) }}
        </li>
      </ul>
    </div>

    <template #footer>
      <p class="text-xs text-muted">
        In <code>nuxt dev</code> this route reaches PGlite through the development socket. On the
        deployed site it reaches whatever <code>DATABASE_URL</code> the host provides, if any.
      </p>
    </template>
  </UCard>
</template>
