import { useLogger, useTerminal } from '@nuxt/kit'
import { describe, expect, it, vi } from 'vitest'

import { collectSocketActions, devtoolsState } from '../../src/dev'
import type { PGliteSocketAction, PGliteSocketActionContext } from '../../src/types'

const noop = () => {}

function fakeSocket() {
  return {
    config: { actions: [{ id: 'count', label: 'Count', run: noop }] },
    dataDir: '/tmp/pglite',
    env: { DATABASE_URL: 'postgres://127.0.0.1:5433/postgres' },
    failure: undefined,
    reset: vi.fn<() => Promise<void>>(async () => {}),
    server: { url: 'postgres://127.0.0.1:5433/postgres', connections: 2 },
  }
}

const options = {
  server: { enabled: false, config: 'server/pglite.config', options: {}, eager: false },
  client: { enabled: false, config: 'app/pglite.config', options: {}, eager: false },
}

describe('collectSocketActions', () => {
  const studio: PGliteSocketAction = { id: 'studio', label: 'Studio', run: noop }

  it("puts the module's reset before the configured actions", async () => {
    const socket = fakeSocket()
    const actions = collectSocketActions(socket, { actions: [studio] })
    expect(actions.map(({ id }) => id)).toEqual(['reset-database', 'studio'])

    await actions[0]?.run({
      socketUrl: socket.server.url,
      env: socket.env,
      startSubprocess: vi.fn<PGliteSocketActionContext['startSubprocess']>(),
      terminal: useTerminal(),
      logger: useLogger('nuxt-pglite'),
    })
    expect(socket.reset).toHaveBeenCalledOnce()
  })

  it('has none without the socket, whose URL they need', () => {
    expect(collectSocketActions(undefined, { actions: [studio] })).toEqual([])
  })
})

describe('devtoolsState', () => {
  it('lists the socket actions under the socket, with their side', () => {
    const socket = fakeSocket()
    const socketActions = collectSocketActions(socket, {
      actions: [{ id: 'studio', label: 'Studio', description: 'Opens it', run: noop }],
    })
    const state = devtoolsState({ options, target: 'socket', route: '/r', socket, socketActions })

    expect(state.socket).toEqual({
      url: socket.server.url,
      connections: 2,
      env: socket.env,
      actions: [
        expect.objectContaining({ id: 'reset-database', side: 'socket' }),
        { id: 'studio', label: 'Studio', description: 'Opens it', side: 'socket' },
      ],
    })
    expect(state.server.instance?.actions).toEqual([
      { id: 'count', label: 'Count', side: 'server' },
    ])
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('has no socket entry while the socket is off', () => {
    const state = devtoolsState({
      options,
      target: undefined,
      route: '/r',
      socket: undefined,
      socketActions: [],
    })
    expect(state.socket).toBeUndefined()
  })
})
