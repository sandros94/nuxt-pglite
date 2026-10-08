import { describe, expect, it } from 'vitest'

import { assertConfigKind, definePGliteConfig, resolveEnvConfig } from '../../../src/runtime/core'
import { definePGliteClientConfig } from '../../../src/runtime/client/config'

describe('config kind', () => {
  it('accepts a config made for the side that loads it, and plain objects', () => {
    const server = definePGliteConfig({ dataDir: 'memory://' })
    expect(assertConfigKind(server, 'server', 'server/pglite.config')).toBe(server)
    expect(assertConfigKind({ ...server }, 'server', 'server/pglite.config')).toBeDefined()
    expect(assertConfigKind({ dataDir: 'x' }, 'client', 'app/pglite.config')).toBeDefined()
  })

  it('rejects a config made with the other helper', () => {
    const client = definePGliteClientConfig({ dataDir: 'idb://x' })
    expect(() => assertConfigKind(client, 'server', 'server/pglite.config')).toThrow(
      'server/pglite.config must use definePGliteServerConfig()',
    )
    expect(() => assertConfigKind(definePGliteConfig({}), 'client', 'app/pglite.config')).toThrow(
      'must use definePGliteClientConfig()',
    )
  })
})

describe('resolveEnvConfig', () => {
  const config = {
    dataDir: 'base',
    $development: { dataDir: 'dev' },
    $production: { dataDir: 'prod' },
    $test: { dataDir: 'test' },
  }

  it('picks the override for the environment and drops the keys', () => {
    expect(resolveEnvConfig(config, { dev: true, test: false })).toEqual({ dataDir: 'dev' })
    expect(resolveEnvConfig(config, { dev: false, test: false })).toEqual({ dataDir: 'prod' })
    expect(resolveEnvConfig(config, { dev: true, test: true })).toEqual({ dataDir: 'test' })
  })

  it('leaves a config without overrides as is', () => {
    expect(resolveEnvConfig({ dataDir: 'base' }, { dev: true, test: false })).toEqual({
      dataDir: 'base',
    })
  })
})
