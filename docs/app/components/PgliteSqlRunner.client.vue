<script setup lang="ts">
import type { Results } from '@electric-sql/pglite'
import type { TableColumn } from '@nuxt/ui'

/** One statement's result, rows as arrays so that repeated column names survive. */
interface StatementResult {
  fields: string[]
  rows: unknown[][]
  affectedRows?: number
}

const props = defineProps<{ query: string }>()

const sql = ref(props.query)
const running = ref(false)
const error = ref<string>()
const results = shallowRef<StatementResult[]>([])
const elapsed = ref<number>()

function columnsOf(result: StatementResult): TableColumn<unknown[]>[] {
  return result.fields.map((name, index) => ({
    id: String(index),
    header: name,
    accessorFn: (row) => row[index],
    cell: ({ row }) => formatValue(row.original[index]),
  }))
}

async function run() {
  running.value = true
  error.value = undefined
  const started = performance.now()
  try {
    const pg = await usePGlite()
    // `rowMode: 'array'` returns rows as arrays, which PGlite's types do not express.
    const output = (await pg.exec(sql.value, { rowMode: 'array' })) as Results<unknown[]>[]
    results.value = output.map((result) => ({
      fields: result.fields.map((field) => field.name),
      rows: result.rows,
      affectedRows: result.affectedRows,
    }))
  } catch (cause) {
    results.value = []
    error.value = errorMessage(cause)
  } finally {
    elapsed.value = performance.now() - started
    running.value = false
  }
}

async function reseed() {
  const pg = await usePGlite()
  await pg.exec(`DROP TABLE IF EXISTS planets; ${PLANETS_SQL}`)
  await run()
}

onMounted(run)
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-database" class="size-4" />
          <span>Your browser's PGlite</span>
          <UBadge v-if="elapsed !== undefined" color="neutral" variant="subtle" size="sm">
            {{ elapsed.toFixed(1) }} ms
          </UBadge>
        </div>
        <div class="flex gap-2">
          <UButton
            label="Reseed"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="reseed"
          />
          <UButton
            label="Run"
            icon="i-lucide-play"
            size="sm"
            :loading="running"
            data-testid="sql-run"
            @click="run"
          />
        </div>
      </div>
    </template>

    <UTextarea
      v-model="sql"
      :rows="3"
      autoresize
      variant="none"
      class="w-full border-b border-default font-mono"
      :ui="{ base: 'font-mono text-sm px-4 py-3' }"
      aria-label="SQL"
      data-testid="sql-input"
      @keydown.meta.enter.prevent="run"
      @keydown.ctrl.enter.prevent="run"
    />

    <div data-testid="sql-results">
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-x"
        :description="error"
        class="rounded-none"
      />
      <template v-for="(result, index) in results" v-else :key="index">
        <UTable
          v-if="result.fields.length"
          :data="result.rows"
          :columns="columnsOf(result)"
          class="max-h-80"
          sticky
        />
        <p v-else class="px-4 py-3 text-sm text-muted">
          OK{{ result.affectedRows ? `, ${result.affectedRows} row(s) affected` : '' }}
        </p>
      </template>
    </div>

    <template #footer>
      <p class="text-xs text-muted">
        Runs in a Web Worker, stored in IndexedDB. Try <code>INSERT</code>,
        <code>CREATE TABLE</code> or several statements at once; <kbd>Ctrl</kbd>/<kbd>⌘</kbd> +
        <kbd>Enter</kbd> runs them.
      </p>
    </template>
  </UCard>
</template>
