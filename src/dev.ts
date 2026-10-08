import { readFile } from 'node:fs/promises'
import { startSubprocess } from '@nuxt/devtools-kit'
import { addDevServerHandler, addPlugin, addServerHandler, useLogger, useTerminal } from '@nuxt/kit'
import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import type { NuxtDevtoolsServerContext } from '@nuxt/devtools-kit/types'

import {
  describeActions,
  describeInstance,
  errorMessage,
  runAction,
  runQuery,
} from './runtime/core/actions'
import type {
  PGliteActionInfo,
  PGliteActionOutcome,
  PGliteInstanceInfo,
  PGliteQueryOutcome,
} from './runtime/core/actions'
import { RESET_ACTION } from './server'
import type { ServerSetup } from './server'
import type {
  PGliteProcessAction,
  PGliteProcessActionContext,
  ResolvedModuleOptions,
} from './types'

/** The devtools tab's page, served from this process. */
export const PAGE_ROUTE = '/__nuxt-pglite'
/**
 * The Nitro endpoint behind the tab. Not nested under the page's route:
 * development handlers match by prefix and would shadow it.
 */
export const SERVER_ROUTE = '/__pglite/server'
/** The devtools RPC namespace; the page calls `extendClientRpc()` with it. */
export const RPC_NAMESPACE = 'nuxt-pglite'

/**
 * Where the server instance lives, which decides where its actions and
 * queries run: the development socket creates it in this process, otherwise
 * `usePGlite()` creates it in Nitro.
 */
type ServerTarget = 'socket' | 'nitro'

/** What the devtools page reads, through the RPC, on load and while it polls. */
export interface DevtoolsState {
  server: {
    enabled: boolean
    eager: boolean
    target?: ServerTarget
    /** The Nitro endpoint, under the app's base URL, when the target is `nitro`. */
    route: string
    socket?: { url: string; connections: number; env: Record<string, string> }
    /** The socket's instance; with the `nitro` target the page asks Nitro. */
    instance?: PGliteInstanceInfo
    /** Why the socket refuses clients: its instance could not be created. */
    refusal?: string
  }
  client: { enabled: boolean; eager: boolean }
  process: { actions: PGliteActionInfo[] }
}

/** The server-side functions the page calls through the devtools RPC. */
export interface DevtoolsRpc {
  getState: () => DevtoolsState
  /** Runs a `process` action, or a `server` one while the socket holds the instance. */
  runAction: (side: 'server' | 'process', id: string) => Promise<PGliteActionOutcome>
  /** Runs SQL against the socket's instance. */
  query: (query: string) => Promise<PGliteQueryOutcome>
}

/**
 * Development tooling: the action runner behind the terminal and the devtools
 * tab. Called in `nuxt dev` only, so that nothing of it reaches a build.
 */
export async function setupDev(
  options: ResolvedModuleOptions,
  nuxt: Nuxt,
  resolver: Resolver,
  server: ServerSetup,
) {
  const { socket } = server
  const target: ServerTarget | undefined = socket
    ? 'socket'
    : options.server.enabled
      ? 'nitro'
      : undefined
  const route = nuxt.options.app.baseURL.replace(/\/+$/, '') + SERVER_ROUTE

  // The reset is the module's own: it needs the instance, which only the
  // socket keeps in this process.
  const processActions: PGliteProcessAction[] = [
    ...(socket
      ? [
          {
            ...RESET_ACTION,
            description:
              "Closes the socket's instance, deletes its data directory and creates it again, running init. Socket only: an instance created by usePGlite() in Nitro is not affected.",
            run: async () => {
              await socket.reset()
              return socket.dataDir ? `Recreated ${socket.dataDir}` : 'Recreated'
            },
          } satisfies PGliteProcessAction,
        ]
      : []),
    ...options.devtools.actions,
  ]
  const runner = createRunner({ nuxt, server, target, route, processActions })

  nuxt.hook('modules:done', async () => {
    await nuxt.callHook('pglite:devtools:actions', processActions)
    // Fails the startup on ambiguous ids rather than the first run.
    describeActions(processActions, 'process')

    // `nuxt dev`'s UI has no way for modules to add a shortcut, so the
    // picker is reachable through a hook. Server actions may live in Nitro,
    // where they are only listed once it answers.
    const hasActions =
      processActions.length > 0 || target === 'nitro' || !!socket?.config.devtools?.actions?.length
    if (runner.terminal.interactive && hasActions) {
      nuxt.hook('pglite:devtools:prompt', () => runner.prompt())
    }
  })

  if (!options.devtools.enabled || !isDevtoolsEnabled(nuxt)) {
    return
  }

  // Through the host's hooks rather than the kit's wrappers, which are what
  // those wrappers call. DevTools 4 replaces this with a dock API and an
  // authorised RPC; its beta could not be driven to completion here, so the
  // move waits for a stable release.
  nuxt.hook('devtools:customTabs', (tabs) => {
    tabs.push({
      name: 'nuxt-pglite',
      title: 'PGlite',
      icon: 'simple-icons:postgresql',
      view: { type: 'iframe', src: PAGE_ROUTE },
    })
  })

  // Read on first request: the page is a single static file, no build step.
  let page: Promise<string> | undefined
  addDevServerHandler({
    route: PAGE_ROUTE,
    handler: async () =>
      new Response(
        await (page ??= readFile(resolver.resolve('./runtime/devtools/page.html'), 'utf8')),
        {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        },
      ),
  })

  if (target === 'nitro') {
    addServerHandler({
      route: SERVER_ROUTE,
      handler: resolver.resolve('./runtime/server/handlers/devtools'),
      env: 'dev',
    })
  }
  if (options.client.enabled) {
    addPlugin({ mode: 'client', src: resolver.resolve('./runtime/client/plugins/devtools.client') })
  }

  const functions: DevtoolsRpc = {
    getState: () => ({
      server: {
        enabled: options.server.enabled,
        eager: options.server.eager,
        target,
        route,
        socket: socket && {
          url: socket.server.url,
          connections: socket.server.connections,
          env: socket.env,
        },
        instance: socket && describeInstance(socket.config, 'server'),
        refusal: socket?.failure?.message,
      },
      client: { enabled: options.client.enabled, eager: options.client.eager },
      process: { actions: describeActions(processActions, 'process') },
    }),
    runAction: async (side, id) => {
      const local =
        side === 'process'
          ? describeActions(processActions, 'process')
          : describeActions(socket?.config.devtools?.actions, 'server')
      const action = local.find((candidate) => candidate.id === id)
      return action
        ? runner.run(action)
        : { ok: false, error: `No ${side} action with the id "${id}" here.` }
    },
    query: (query) => runner.query(query),
  }

  // DevTools 4 registers functions on its Vite DevTools context; DevTools 3
  // has the namespaced RPC. The host decides which hook fires.
  nuxt.hook('devtools:initialized', () => {
    // The host sets `nuxt.devtools` once initialised; the kit types it loosely.
    const host: { devtools?: NuxtDevtoolsServerContext; options: unknown } = nuxt
    host.devtools?.extendServerRpc<object, DevtoolsRpc>(RPC_NAMESPACE, functions)
  })
}

/** Mirrors the rule Nuxt itself installs DevTools by. */
function isDevtoolsEnabled(nuxt: Nuxt) {
  const { builder, devtools } = nuxt.options
  if (builder !== '@nuxt/vite-builder') {
    return false
  }
  if (typeof devtools === 'boolean') {
    return devtools
  }
  // Typed as set, but unset unless configured, which Nuxt reads as enabled.
  return devtools.enabled ?? true
}

interface RunnerOptions {
  nuxt: Nuxt
  server: ServerSetup
  target: ServerTarget | undefined
  route: string
  processActions: PGliteProcessAction[]
}

/**
 * Runs `server` and `process` actions from this process: directly where they
 * live here, over HTTP where they live in Nitro. Each run is shown as a task
 * in the terminal, ending with its result.
 */
function createRunner({ nuxt, server, target, route, processActions }: RunnerOptions) {
  const { socket } = server
  const logger = useLogger('nuxt-pglite')
  const terminal = useTerminal()

  let origin: string | undefined
  nuxt.hook('listen', (_server, listener: { url?: string }) => {
    origin = listener.url
  })

  async function nitro<T>(body?: object): Promise<T> {
    if (!origin) {
      throw new Error('The dev server is not listening yet.')
    }
    const response = await fetch(new URL(route, origin), {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`${route} answered ${response.status}.`)
    }
    // The endpoint is this module's own, so its shape is known.
    const data: T = await response.json()
    return data
  }

  const context: PGliteProcessActionContext = {
    socketUrl: socket?.server.url,
    env: { ...socket?.env },
    dataDir: socket ? socket.dataDir : server.dataDir,
    startSubprocess: (execaOptions, tabOptions) => startSubprocess(execaOptions, tabOptions, nuxt),
    terminal,
    logger,
  }

  async function execute({ side, id }: PGliteActionInfo): Promise<PGliteActionOutcome> {
    if (side === 'process') {
      return runAction(processActions, 'process', id, () => context)
    }
    if (socket) {
      return runAction(socket.config.devtools?.actions, 'server', id, () => ({ pg: socket.use() }))
    }
    if (target === 'nitro') {
      return nitro<PGliteActionOutcome>({ action: id }).catch((error: unknown) => ({
        ok: false,
        error: errorMessage(error),
      }))
    }
    return { ok: false, error: 'The server side is disabled.' }
  }

  async function run(action: PGliteActionInfo): Promise<PGliteActionOutcome> {
    const task = terminal.startTask(`Running ${action.label}…`)
    const outcome = await execute(action)
    if (outcome.ok) {
      task.stop(`${action.label}: ${summarize(outcome.result)}`)
    } else {
      task.stop(`${action.label} failed: ${outcome.error}`, 'failure')
    }
    return outcome
  }

  /** The actions the terminal offers: the server's and the process's. */
  async function list(): Promise<PGliteActionInfo[]> {
    let serverActions: PGliteActionInfo[] = []
    if (socket) {
      serverActions = describeActions(socket.config.devtools?.actions, 'server')
    } else if (target === 'nitro') {
      serverActions = await nitro<PGliteInstanceInfo>().then(
        (info) => info.actions,
        (error: unknown) => {
          logger.warn(`Could not list the server actions: ${errorMessage(error)}`)
          return []
        },
      )
    }
    return [...serverActions, ...describeActions(processActions, 'process')]
  }

  return {
    terminal,
    run,

    query(query: string): Promise<PGliteQueryOutcome> {
      if (!socket) {
        return Promise.resolve({ ok: false, error: 'The development socket is not running.' })
      }
      return runQuery(() => socket.use(), query)
    },

    async prompt() {
      const actions = await list()
      if (actions.length === 0) {
        terminal.notify({ message: 'There are no PGlite actions to run.' })
        return
      }
      const picked: unknown = await terminal.prompt('Run a PGlite action', {
        type: 'select',
        cancel: 'null',
        options: actions.map((action, index) => ({
          label: `${action.label} (${action.side})`,
          value: String(index),
          hint: action.description,
        })),
      })
      const action = typeof picked === 'string' ? actions[Number(picked)] : undefined
      if (action) {
        await run(action)
      }
    },
  }
}

/** One line for the terminal; the devtools page shows the full result. */
function summarize(result: unknown) {
  if (result === null) {
    return 'done'
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result)
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}
