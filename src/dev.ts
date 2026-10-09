import { readFile } from 'node:fs/promises'
import {
  addCustomTab,
  extendServerRpc,
  onDevToolsInitialized,
  startSubprocess,
} from '@nuxt/devtools-kit'
import { addDevServerHandler, addPlugin, addServerHandler, useLogger, useTerminal } from '@nuxt/kit'
import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'

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
import type { RunningSocket, ServerSetup } from './server'
import type {
  PGliteSocketAction,
  PGliteSocketActionContext,
  ResolvedModuleOptions,
  SocketOptions,
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
    /** The socket's instance; with the `nitro` target the page asks Nitro. */
    instance?: PGliteInstanceInfo
    /** Why the socket refuses clients: its instance could not be created. */
    refusal?: string
  }
  client: { enabled: boolean; eager: boolean }
  /** The development socket, when it runs, with the actions that run next to it. */
  socket?: {
    url: string
    connections: number
    env: Record<string, string>
    actions: PGliteActionInfo[]
  }
}

/** The server-side functions the page calls through the devtools RPC. */
export interface DevtoolsRpc {
  getState: () => DevtoolsState
  /** Runs a `socket` action, or a `server` one while the socket holds the instance. */
  runAction: (side: 'server' | 'socket', id: string) => Promise<PGliteActionOutcome>
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

  const socketActions = collectSocketActions(socket, options.socket)
  const runner = createRunner({ nuxt, socket, target, route, socketActions })

  nuxt.hook('modules:done', async () => {
    // Without the socket, other modules' actions would have nothing to reach.
    if (socket) {
      await nuxt.callHook('pglite:devtools:actions', socketActions)
      // Fails the startup on ambiguous ids rather than the first run.
      describeActions(socketActions, 'socket')
    }

    // `nuxt dev`'s UI has no way for modules to add a shortcut, so the
    // picker is reachable through a hook. Server actions may live in Nitro,
    // where they are only listed once it answers; with the socket, its reset
    // is always there.
    const hasActions = socketActions.length > 0 || target === 'nitro'
    if (runner.terminal.interactive && hasActions) {
      nuxt.hook('pglite:devtools:prompt', () => runner.prompt())
    }
  })

  if (!options.devtools || !isDevtoolsEnabled(nuxt)) {
    return
  }

  /**
   * DevTools 3, which Nuxt 4 installs. DevTools 4 replaces the tab and the
   * namespaced RPC with a dock API and an authorised RPC; the move waits for
   * Nuxt to depend on a stable release.
   */
  addCustomTab(
    {
      name: 'nuxt-pglite',
      title: 'PGlite',
      icon: 'simple-icons:postgresql',
      view: { type: 'iframe', src: PAGE_ROUTE },
    },
    nuxt,
  )

  // Read on first request: the page is a single static file, no build step.
  let page: Promise<string> | undefined
  addDevServerHandler({
    route: PAGE_ROUTE,
    handler: {
      nuxt: async () =>
        new Response(
          await (page ??= readFile(resolver.resolve('./runtime/devtools/page.html'), 'utf8')),
          {
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          },
        ),
    },
  })

  if (target === 'nitro') {
    addServerHandler({
      route: SERVER_ROUTE,
      handler: { nuxt: resolver.resolve('./runtime/server/handlers/devtools') },
      env: 'dev',
    })
  }
  if (options.client.enabled) {
    addPlugin({ mode: 'client', src: resolver.resolve('./runtime/client/plugins/devtools.client') })
  }

  const functions: DevtoolsRpc = {
    getState: () => devtoolsState({ options, target, route, socket, socketActions }),
    runAction: async (side, id) => {
      const local =
        side === 'socket'
          ? describeActions(socketActions, 'socket')
          : describeActions(socket?.config.devtoolsActions, 'server')
      const action = local.find((candidate) => candidate.id === id)
      return action
        ? runner.run(action)
        : { ok: false, error: `No ${side} action with the id "${id}" here.` }
    },
    query: (query) => runner.query(query),
  }

  onDevToolsInitialized(() => {
    extendServerRpc<object, DevtoolsRpc>(RPC_NAMESPACE, functions, nuxt)
  }, nuxt)
}

/** What the devtools tooling reads of the running socket. */
type SocketView = Pick<RunningSocket, 'config' | 'dataDir' | 'env' | 'failure' | 'reset'> & {
  server: Pick<RunningSocket['server'], 'url' | 'connections'>
}

/**
 * The `socket` actions from `nuxt.config`, after the module's own reset, which
 * needs the instance only the socket keeps in this process. None without the
 * socket: they reach the database through it.
 */
export function collectSocketActions(
  socket: Pick<SocketView, 'dataDir' | 'reset'> | undefined,
  options: boolean | SocketOptions,
): PGliteSocketAction[] {
  if (!socket) {
    return []
  }
  const reset: PGliteSocketAction = {
    ...RESET_ACTION,
    description:
      "Closes the socket's instance, deletes its data directory and creates it again, running init. Socket only: an instance created by usePGlite() in Nitro is not affected.",
    run: async () => {
      await socket.reset()
      return socket.dataDir ? `Recreated ${socket.dataDir}` : 'Recreated'
    },
  }
  return [reset, ...(typeof options === 'object' ? (options.devtoolsActions ?? []) : [])]
}

interface StateSources {
  options: Pick<ResolvedModuleOptions, 'server' | 'client'>
  target: ServerTarget | undefined
  route: string
  socket: SocketView | undefined
  socketActions: readonly PGliteSocketAction[]
}

/** What `getState` answers: read anew on every call, as the page polls it. */
export function devtoolsState({
  options,
  target,
  route,
  socket,
  socketActions,
}: StateSources): DevtoolsState {
  return {
    server: {
      enabled: options.server.enabled,
      eager: options.server.eager,
      target,
      route,
      instance: socket && describeInstance(socket.config, 'server'),
      refusal: socket?.failure?.message,
    },
    client: { enabled: options.client.enabled, eager: options.client.eager },
    socket: socket && {
      url: socket.server.url,
      connections: socket.server.connections,
      env: socket.env,
      actions: describeActions(socketActions, 'socket'),
    },
  }
}

/**
 * Mirrors the rule Nuxt itself installs DevTools by. Not `hasNuxtModule()`:
 * Nuxt installs DevTools after the user's modules, so it is not listed yet.
 */
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
  socket: ServerSetup['socket']
  target: ServerTarget | undefined
  route: string
  socketActions: PGliteSocketAction[]
}

/**
 * Runs `server` and `socket` actions from this process: directly where they
 * live here, over HTTP where they live in Nitro. Each run is shown as a task
 * in the terminal, ending with its result.
 */
function createRunner({ nuxt, socket, target, route, socketActions }: RunnerOptions) {
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

  const context: PGliteSocketActionContext | undefined = socket && {
    socketUrl: socket.server.url,
    env: { ...socket.env },
    dataDir: socket.dataDir,
    startSubprocess: (execaOptions, tabOptions) => startSubprocess(execaOptions, tabOptions, nuxt),
    terminal,
    logger,
  }

  async function execute({ side, id }: PGliteActionInfo): Promise<PGliteActionOutcome> {
    if (side === 'socket') {
      return context
        ? runAction(socketActions, 'socket', id, () => context)
        : { ok: false, error: 'The development socket is not running.' }
    }
    if (socket) {
      return runAction(socket.config.devtoolsActions, 'server', id, () => ({ pg: socket.use() }))
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

  /** The actions the terminal offers: the server's and the socket's. */
  async function list(): Promise<PGliteActionInfo[]> {
    let serverActions: PGliteActionInfo[] = []
    if (socket) {
      serverActions = describeActions(socket.config.devtoolsActions, 'server')
    } else if (target === 'nitro') {
      serverActions = await nitro<PGliteInstanceInfo>().then(
        (info) => info.actions,
        (error: unknown) => {
          logger.warn(`Could not list the server actions: ${errorMessage(error)}`)
          return []
        },
      )
    }
    return [...serverActions, ...describeActions(socketActions, 'socket')]
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
