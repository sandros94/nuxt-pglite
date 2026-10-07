<script setup lang="ts">
interface Todo {
  id: number
  title: string
  done: boolean
}

const { rows: todos } = useLiveQuery<Todo>('SELECT * FROM todos ORDER BY id')

const title = ref('')
const error = ref<string>()

async function guard(task: () => Promise<unknown>) {
  error.value = undefined
  try {
    await task()
  } catch (cause) {
    error.value = errorMessage(cause)
  }
}

function add() {
  const value = title.value.trim()
  if (!value) {
    return
  }
  title.value = ''
  return guard(async () => {
    const pg = await usePGlite()
    await pg.query('INSERT INTO todos (title) VALUES ($1)', [value])
  })
}

function toggle(todo: Todo) {
  return guard(async () => {
    const pg = await usePGlite()
    await pg.query('UPDATE todos SET done = NOT done WHERE id = $1', [todo.id])
  })
}

function remove(todo: Todo) {
  return guard(async () => {
    const pg = await usePGlite()
    await pg.query('DELETE FROM todos WHERE id = $1', [todo.id])
  })
}

function clear() {
  return guard(async () => {
    const pg = await usePGlite()
    await pg.query('DELETE FROM todos')
  })
}
</script>

<template>
  <UCard data-testid="live-demo">
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-radio" class="size-4 text-primary" />
          <span>Live: <code>SELECT * FROM todos</code></span>
        </span>
        <UButton
          label="Clear"
          icon="i-lucide-trash"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="!todos?.length"
          @click="clear"
        />
      </div>
    </template>

    <form class="flex gap-2" @submit.prevent="add">
      <UInput
        v-model="title"
        placeholder="Something to do"
        class="flex-1"
        aria-label="New todo"
        data-testid="todo-input"
      />
      <UButton type="submit" icon="i-lucide-plus" label="Add" data-testid="todo-add" />
    </form>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      :description="error"
      class="mt-3"
    />

    <ul class="mt-3 divide-y divide-default" data-testid="todo-list">
      <li v-for="todo in todos" :key="todo.id" class="flex items-center gap-3 py-2">
        <UCheckbox
          :model-value="todo.done"
          :aria-label="`Toggle ${todo.title}`"
          @update:model-value="toggle(todo)"
        />
        <span class="flex-1 text-sm" :class="todo.done && 'text-muted line-through'">
          {{ todo.title }}
        </span>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="`Delete ${todo.title}`"
          @click="remove(todo)"
        />
      </li>
    </ul>
    <p v-if="todos && !todos.length" class="py-2 text-sm text-muted">
      No todos yet. Add one, or open this page in a second tab and add it there.
    </p>
  </UCard>
</template>
