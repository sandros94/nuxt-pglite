import type { WatchCallback, WatchOptions, WatchSource, WatchStopHandle } from 'vue'
import { ref, nextTick, watch, useNuxtApp } from '#imports'

const hydrationState = ref(false)
let hydrationWatcherInit = false

export const useHydrationState = () => {
  const app = useNuxtApp()
  // hydrationState should be false at this time
  if (import.meta.server || !app.isHydrating) return hydrationState

  // Avoid ref trigger if already true
  if (!hydrationState.value) hydrationState.value = true

  // Avoid duplicate hook watchers
  if (!hydrationWatcherInit) {
    hydrationWatcherInit = true
    app.hooks.hookOnce('app:suspense:resolve', () => {
      hydrationState.value = false
    })
  }

  return hydrationState
}

// From @vueuse/core https://vueuse.org/shared/watchOnce/#watchonce
export function watchOnce<T, Immediate extends Readonly<boolean> = false>(
  source: WatchSource<T>,
  cb: WatchCallback<T, Immediate extends true ? T | undefined : T>,
  options?: WatchOptions<Immediate>,
): WatchStopHandle {
  const stop = watch(source, (...args) => {
    nextTick(() => stop())

    return cb(...args)
  }, options)

  return stop
}
