/** `/api/visits` on success; failures are HTTP errors carrying a `DatabaseError`. */
export interface VisitsResponse {
  total: number
  latest: { id: number; createdAt: string }[]
}
