import type { PGliteInterfaceExtensions, PGliteOptions } from '@electric-sql/pglite'
import { PGlite } from '@electric-sql/pglite'

import { useRuntimeConfig } from '#imports'
// import { extensions } from '#nitro-build/pglite-extensions'

type PGliteInterface<E> = PGlite & PGliteInterfaceExtensions<E>

let pglite: PGliteInterface<unknown> | undefined
export function usePGlite<T extends PGliteOptions['extensions']>(extensions?: T): PGliteInterface<T> {
  if (!pglite) {
    pglite = new PGlite({
      ...useRuntimeConfig().pglite,
      extensions,
    }) as PGliteInterface<T>
  }

  return pglite as PGliteInterface<T>
}
