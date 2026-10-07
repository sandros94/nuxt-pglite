// Port of the upstream implementatoin https://github.com/electric-sql/pglite/blob/9aff6739389647ee55e439c7b08a970c40ac3329/packages/pglite-vue/src/hooks.ts
import type { WatchSource, DeepReadonly, ToRefs } from 'vue'
import { query as buildQuery } from '@electric-sql/pglite/template'
import type { live } from '@electric-sql/pglite/live'
import type { PGliteInterfaceExtensions, Results } from '@electric-sql/pglite'

import {
  watch,
  readonly,
  shallowReactive,
  toRefs,
  shallowRef,
  onScopeDispose,
  ref,
  isRef,
  unref,
  createError,
} from '#imports'

import { usePGlite } from './pglite'

type UnsubscribeFn = () => Promise<void>
type QueryParams = unknown[] | undefined | null
type QueryResult<T> =
  | Omit<Results<T>, 'affectedRows'>
  | { rows: undefined; fields: undefined; blob: undefined }
type LiveQueryResults<T> = ToRefs<DeepReadonly<QueryResult<T>>>
type LiveNamespace = PGliteInterfaceExtensions<{ live: typeof live }>['live']

// The instance is typed from the client config; `live` is checked here so that
// a config without it fails with a pointer instead of an undefined call.
function hasLive(pg: object): pg is { live: LiveNamespace } {
  return 'live' in pg
}

async function useLive(): Promise<LiveNamespace> {
  const pg: object = await usePGlite()
  if (!hasLive(pg)) {
    throw createError({
      statusCode: 500,
      message:
        '[nuxt-pglite] Live queries need the `live` extension in `clientExtensions` of the client config.',
    })
  }
  return pg.live
}

function useLiveQueryImpl<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params?: QueryParams | WatchSource<QueryParams> | WatchSource<unknown>[],
  key?: string | WatchSource<string>,
): LiveQueryResults<T> {
  if (import.meta.server)
    throw createError({
      statusCode: 500,
      statusMessage: 'Client-side only',
      message:
        '[pglite] `useLiveQuery()` and `useLiveIncrementalQuery()` composables should only be called client-side',
    })

  const live = useLive()

  const liveUpdate = shallowReactive<
    Omit<Results<T>, 'affectedRows'> | { rows: undefined; fields: undefined; blob: undefined }
  >({
    rows: undefined,
    fields: undefined,
    blob: undefined,
  })

  // keep track of live query subscriptions to unsubscribe when scope is disposed
  const unsubscribeRef = shallowRef<UnsubscribeFn>()

  const querySource = typeof query === 'string' ? ref(query) : query
  const paramsSources = !params ? [] : Array.isArray(params) ? params.map(ref) : [ref(params)]

  const keySource = typeof key === 'string' ? ref(key) : key

  watch(
    key !== undefined
      ? [querySource, keySource, ...paramsSources]
      : [querySource, ...paramsSources],
    () => {
      let cancelled = false
      const cb = (results: Results<T>) => {
        if (cancelled) return
        liveUpdate.rows = results.rows
        liveUpdate.fields = results.fields
        if (results.blob !== undefined) {
          liveUpdate.blob = results.blob
        }
      }

      const queryVal = isRef(querySource) ? unref(querySource) : querySource()

      const paramVals = Array.isArray(params)
        ? params.map((p) => (typeof p === 'function' ? p() : unref(p)))
        : typeof params === 'function'
          ? params()
          : unref(params)

      const keyVal = isRef(keySource) ? keySource.value : keySource?.()

      const ret = live.then((db) =>
        keyVal !== undefined
          ? db.incrementalQuery<T>(queryVal, paramVals, keyVal, cb)
          : db.query<T>(queryVal, paramVals, cb),
      )

      unsubscribeRef.value = () => {
        cancelled = true
        return ret.then(({ unsubscribe }) => unsubscribe())
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => unsubscribeRef.value?.(), true)

  return toRefs(readonly(liveUpdate))
}

export function useLiveQuery<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params?: QueryParams | WatchSource<QueryParams> | WatchSource<unknown>[],
): LiveQueryResults<T> {
  return useLiveQueryImpl<T>(query, params)
}

useLiveQuery.sql = function <T = { [key: string]: unknown }>(
  strings: TemplateStringsArray,
  ...values: any[]
): LiveQueryResults<T> {
  const { query, params } = buildQuery(strings, ...values)
  return useLiveQueryImpl<T>(query, params)
}

export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params: QueryParams | WatchSource<QueryParams> | WatchSource<unknown>[],
  key: string | WatchSource<string>,
): LiveQueryResults<T> {
  return useLiveQueryImpl<T>(query, params, key)
}
