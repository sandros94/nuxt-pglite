import {
  useNuxtApp,
} from '#imports'

export function usePGlite() {
  return useNuxtApp().$pglite
}
