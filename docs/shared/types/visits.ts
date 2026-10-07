/** What `/api/visits` answers: the latest rows, or why there are none. */
export type VisitsResponse =
  | { status: 'unconfigured'; message: string }
  | { status: 'error'; message: string }
  | {
      status: 'ok'
      total: number
      latest: { id: number; createdAt: string }[]
    }
