import type { PGliteInstance } from '#pglite/app/plugins/pglite'

import {
  createError,
  useNuxtApp,
} from '#imports'

export function usePGlite(): PGliteInstance {
  if (import.meta.server) throw createError({
    statusCode: 500,
    statusMessage: 'Client-side only',
    message: '[pglite] `usePGlite()` composable should only be called client-side',
  })
  return useNuxtApp().$pglite
}
