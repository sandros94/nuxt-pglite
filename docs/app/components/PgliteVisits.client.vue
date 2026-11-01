<script setup lang="ts">
import { FetchError } from 'ofetch'

type State =
  | { status: 'ok'; visits: VisitsResponse }
  | { status: 'unconfigured' | 'error'; title: string; message: string }

const state = shallowRef<State>()
const loading = ref(false)

async function request(method: 'GET' | 'POST') {
  loading.value = true
  try {
    state.value = { status: 'ok', visits: await $fetch<VisitsResponse>('/api/visits', { method }) }
  } catch (error) {
    state.value = failure(error)
  } finally {
    loading.value = false
  }
}

/** The `503` the route answers without a database is a warning; any other failure is an error. */
function failure(error: unknown): State {
  if (error instanceof FetchError && error.data) {
    const data = error.data as { statusMessage?: string; message?: string; data?: DatabaseError }
    return {
      status: data.data?.reason === 'unconfigured' ? 'unconfigured' : 'error',
      title: data.statusMessage ?? 'The request failed',
      message: data.message ?? errorMessage(error),
    }
  }
  return { status: 'error', title: 'The request failed', message: errorMessage(error) }
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
          <span><code>/api/visits</code>, Drizzle over <code>NETLIFY_DB_URL</code></span>
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
            :disabled="state?.status !== 'ok'"
            data-testid="visit-add"
            @click="request('POST')"
          />
        </div>
      </div>
    </template>

    <USkeleton v-if="!state" class="h-24 w-full" />

    <UAlert
      v-else-if="state.status !== 'ok'"
      :color="state.status === 'unconfigured' ? 'warning' : 'error'"
      variant="subtle"
      :icon="state.status === 'unconfigured' ? 'i-lucide-database-zap' : 'i-lucide-circle-x'"
      :title="state.title"
      :description="state.message"
      :data-testid="`server-demo-${state.status}`"
    />

    <div v-else data-testid="server-demo-ok">
      <p class="text-sm">
        <span class="font-semibold text-highlighted">{{ state.visits.total }}</span>
        visit(s) recorded. Latest:
      </p>
      <ul class="mt-2 space-y-1 font-mono text-xs text-muted">
        <li v-for="visit in state.visits.latest" :key="visit.id">
          #{{ visit.id }} · {{ formatDate(visit.createdAt) }}
        </li>
      </ul>
    </div>

    <template #footer>
      <p class="text-xs text-muted">
        In <code>nuxt dev</code> this route reaches PGlite through the development socket. On the
        deployed site it reaches Netlify Database, when it is enabled on the site.
      </p>
    </template>
  </UCard>
</template>
