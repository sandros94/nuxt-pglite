import { describe, expect, it } from 'vitest'

import { resolveSocketEnv } from '../../../src/runtime/socket/env'

const url = 'postgres://postgres@127.0.0.1:5433/postgres'

describe('resolveSocketEnv', () => {
  it('exports DATABASE_URL by default', () => {
    expect(resolveSocketEnv({}, url)).toEqual({ DATABASE_URL: url })
  })

  it('renames the variable with a string', () => {
    expect(resolveSocketEnv({ env: 'PG_URL' }, url)).toEqual({ PG_URL: url })
  })

  it('exports nothing with false, a provider included', () => {
    expect(resolveSocketEnv({ env: false }, url)).toEqual({})
    expect(resolveSocketEnv({ env: false, provider: 'netlify' }, url)).toEqual({})
  })

  it('calls functions with the URL and exports strings as they are', () => {
    expect(
      resolveSocketEnv(
        { env: { DATABASE_URL: (u) => u, POOLED_URL: (u) => `${u}?pool=1`, DB_DRIVER: 'server' } },
        url,
      ),
    ).toEqual({ DATABASE_URL: url, POOLED_URL: `${url}?pool=1`, DB_DRIVER: 'server' })
  })

  it('exports only the provider preset, without DATABASE_URL', () => {
    expect(resolveSocketEnv({ provider: 'netlify' }, url)).toEqual({
      NETLIFY_DB_URL: url,
      NETLIFY_DB_DRIVER: 'server',
    })
  })

  it('merges env over the provider preset', () => {
    expect(
      resolveSocketEnv(
        { provider: 'netlify', env: { NETLIFY_DB_DRIVER: 'serverless', DATABASE_URL: (u) => u } },
        url,
      ),
    ).toEqual({ NETLIFY_DB_URL: url, NETLIFY_DB_DRIVER: 'serverless', DATABASE_URL: url })
    expect(resolveSocketEnv({ provider: 'netlify', env: 'DATABASE_URL' }, url)).toEqual({
      NETLIFY_DB_URL: url,
      NETLIFY_DB_DRIVER: 'server',
      DATABASE_URL: url,
    })
  })
})
