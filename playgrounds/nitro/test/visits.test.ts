import { serverFetch } from 'nitro'
import { describe, expect, inject, it } from 'vitest'

async function fetchJSON(path: string, init?: RequestInit): Promise<unknown> {
  const res = await serverFetch(path, init)
  expect(res.status).toBe(200)
  return res.json()
}

const visit = (id: number) => ({ id, createdAt: expect.any(String) })

describe('/api/visits', () => {
  it('reaches the database of the run', () => {
    // DX gap 1: an already-set `DATABASE_URL` silently wins over the setup's.
    // The routes run in this worker, which inherited the variables of the setup.
    expect(process.env.DATABASE_URL).toBe(inject('pglite').url)
  })

  it('starts with no visits', async () => {
    expect(await fetchJSON('/api/visits')).toEqual({ total: 0, latest: [] })
  })

  it('records a visit per POST', async () => {
    expect(await fetchJSON('/api/visits', { method: 'POST' })).toEqual(visit(1))
    expect(await fetchJSON('/api/visits', { method: 'POST' })).toEqual(visit(2))
  })

  it('lists the recorded visits, latest first', async () => {
    expect(await fetchJSON('/api/visits')).toEqual({ total: 2, latest: [visit(2), visit(1)] })
  })
})
