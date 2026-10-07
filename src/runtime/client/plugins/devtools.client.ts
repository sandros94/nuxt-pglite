import { defineNuxtPlugin } from '#imports'

import { describeInstance, runAction, runQuery } from '../../core/actions'
import type {
  PGliteActionOutcome,
  PGliteInstanceInfo,
  PGliteQueryOutcome,
} from '../../core/actions'
import { pglite } from '../pglite'
import config from '#pglite/client-config'

/**
 * What the devtools tab calls on the app it inspects. Client actions run here,
 * in the app's window, because the worker instance belongs to it; the tab
 * only ever receives descriptions and outcomes.
 */
export interface PGliteDevtoolsBridge {
  describe: () => PGliteInstanceInfo
  run: (id: string) => Promise<PGliteActionOutcome>
  query: (sql: string) => Promise<PGliteQueryOutcome>
}

// The tab reaches the app through `NuxtDevtoolsIframeClient.host.nuxt` and
// looks this key up with the same `Symbol.for()`: the registry is shared
// between same-origin frames, so no name is added to the app's `NuxtApp`.
const BRIDGE = Symbol.for('nuxt-pglite:devtools')

// Registered in development only, with DevTools and the client side enabled.
export default defineNuxtPlugin({
  name: 'nuxt-pglite:devtools',
  env: { islands: false },
  setup(nuxtApp) {
    const bridge: PGliteDevtoolsBridge = {
      describe: () => describeInstance(config, 'client'),
      // Only a run creates the worker, as `usePGlite()` would.
      run: (id) =>
        runAction(config.devtools?.actions, 'client', id, async () => ({ pg: await pglite.use() })),
      query: (sql) => runQuery(() => pglite.use(), sql),
    }
    Object.defineProperty(nuxtApp, BRIDGE, { value: bridge })
  },
})
