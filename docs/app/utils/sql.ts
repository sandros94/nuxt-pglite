/** One cell as text: `NULL`, ISO dates and JSON for anything structured. */
export function formatValue(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
    case 'boolean':
    case 'bigint':
      return value.toString()
    case 'object':
      if (value === null) {
        return 'NULL'
      }
      return value instanceof Date ? value.toISOString() : JSON.stringify(value)
    case 'undefined':
      return 'NULL'
    default:
      return `[${typeof value}]`
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
