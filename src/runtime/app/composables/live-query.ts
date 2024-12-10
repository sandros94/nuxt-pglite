// Port of the upstream implementatoin https://github.com/electric-sql/pglite/blob/9aff6739389647ee55e439c7b08a970c40ac3329/packages/pglite-vue/src/hooks.ts
import type { WatchSource, DeepReadonly, ToRefs } from 'vue-demi'
import { query as buildQuery } from '@electric-sql/pglite/template'
import type { live } from '@electric-sql/pglite/live'
import type { Results } from '@electric-sql/pglite'

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
  usePGlite } from '#imports'
import type {
  Extensions,
  PGlite,
  PGliteOptions,
  PGliteWorker,
  PGliteWorkerOptions,
} from '#pglite-utils'

type UnsubscribeFn = () => Promise<void>
type QueryParams = unknown[] | undefined | null
type QueryResult<T> =
  | Omit<Results<T>, 'affectedRows'>
  | { rows: undefined, fields: undefined, blob: undefined }
type LiveQueryResults<T> = ToRefs<DeepReadonly<QueryResult<T>>>
type PGliteInstance<T extends Extensions> =
  | PGliteWorker<PGliteWorkerOptions<T>>
  | PGlite<PGliteOptions<T>>

function useLiveQueryImpl<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params?: QueryParams | WatchSource<QueryParams> | WatchSource<unknown>[],
  key?: string | WatchSource<string>,
): LiveQueryResults<T> {
  const db = usePGlite() as PGliteInstance<{ live: typeof live }>

  const liveUpdate = shallowReactive<
    | Omit<Results<T>, 'affectedRows'>
    | { rows: undefined, fields: undefined, blob: undefined }
  >({
    rows: undefined,
    fields: undefined,
    blob: undefined,
  })

  // keep track of live query subscriptions to unsubscribe when scope is disposed
  const unsubscribeRef = shallowRef<UnsubscribeFn>()

  const querySource = typeof query === 'string' ? ref(query) : query
  const paramsSources = !params
    ? [ref(params)]
    : Array.isArray(params)
      ? params.map(ref)
      : [params]

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

      const query = isRef(querySource) ? unref(querySource) : querySource()

      const paramVals = isRef(params)
        ? unref(params)
        : typeof params === 'function'
          ? params()
          : Array.isArray(params)
            ? params.map(unref)
            : [params]

      const key = isRef(keySource) ? keySource.value : keySource?.()

      const ret
        = key !== undefined
          ? db.live.incrementalQuery<T>(query, paramVals, key, cb)
          : db.live.query<T>(query, paramVals, cb)

      unsubscribeRef.value = () => {
        cancelled = true
        return ret.then(({ unsubscribe }) => unsubscribe())
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => unsubscribeRef.value?.())

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
