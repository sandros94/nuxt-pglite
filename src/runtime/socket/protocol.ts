// The subset of the PostgreSQL wire protocol (v3) the server needs. Pure functions, no I/O.
// https://www.postgresql.org/docs/current/protocol-message-formats.html

// Byte1 identifiers of the messages the server inspects or builds.
export const FrontendMessage = {
  Bind: 0x42, // 'B'
  Close: 0x43, // 'C'
  Describe: 0x44, // 'D'
  Parse: 0x50, // 'P'
  Query: 0x51, // 'Q'
  Sync: 0x53, // 'S'
  Terminate: 0x58, // 'X'
} as const

export const BackendMessage = {
  Authentication: 0x52, // 'R'
  BackendKeyData: 0x4b, // 'K'
  ErrorResponse: 0x45, // 'E'
  NotificationResponse: 0x41, // 'A'
  ParameterStatus: 0x53, // 'S'
  ReadyForQuery: 0x5a, // 'Z'
} as const

export const PROTOCOL_VERSION_3_0 = 196608

const SSL_REQUEST_CODE = 80877103
const GSSENC_REQUEST_CODE = 80877104
const CANCEL_REQUEST_CODE = 80877102

// Postgres refuses startup packets longer than this (MAX_STARTUP_PACKET_LENGTH).
const MAX_STARTUP_PACKET_LENGTH = 10000

// Kind byte of Describe and Close for a prepared statement, as opposed to a
// portal ('P').
const STATEMENT_KIND = 0x53 // 'S'

// ReadyForQuery status: idle, in a transaction block, or in a failed one.
export type TransactionStatus = 'I' | 'T' | 'E'

const TRANSACTION_STATUS: Record<number, TransactionStatus> = { 0x49: 'I', 0x54: 'T', 0x45: 'E' }

// Packets received before the handshake completes, the only ones without a
// leading type byte.
export type StartupPacket =
  | { kind: 'ssl-request' }
  | { kind: 'gssenc-request' }
  | { kind: 'cancel-request' }
  | { kind: 'startup'; protocolVersion: number }

// Bytes that cannot be framed as protocol messages. SQLSTATE 08P01
// (protocol_violation).
export class ProtocolError extends Error {
  readonly code = '08P01'

  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0]) {
    return parts[0]
  }

  let length = 0

  for (const part of parts) {
    length += part.length
  }

  const result = new Uint8Array(length)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

function readUint8(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint8(offset)
}

function readInt32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset)
}

function cString(value: string): Uint8Array {
  return concatBytes(textEncoder.encode(value), new Uint8Array(1))
}

function int32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)

  new DataView(bytes.buffer).setInt32(0, value)

  return bytes
}

// `Byte1(type) | Int32(length) | body`, where `length` includes itself but not
// the type byte.
function buildMessage(type: number, ...body: Uint8Array[]): Uint8Array {
  const payload = concatBytes(...body)
  const message = new Uint8Array(5 + payload.length)

  message[0] = type
  new DataView(message.buffer).setInt32(1, 4 + payload.length)
  message.set(payload, 5)

  return message
}

// Reads the first startup-phase packet (`Int32(length) | Int32(code) | ...`)
// off `buffer`, or undefined until it has fully arrived.
export function readStartupPacket(
  buffer: Uint8Array,
): { packet: StartupPacket; length: number } | undefined {
  if (buffer.length < 4) {
    return undefined
  }

  const length = readInt32(buffer, 0)

  if (length < 8 || length > MAX_STARTUP_PACKET_LENGTH) {
    throw new ProtocolError(`Invalid startup packet length ${String(length)}.`)
  }

  if (buffer.length < length) {
    return undefined
  }

  const code = readInt32(buffer, 4)

  switch (code) {
    case SSL_REQUEST_CODE:
      return { packet: { kind: 'ssl-request' }, length }
    case GSSENC_REQUEST_CODE:
      return { packet: { kind: 'gssenc-request' }, length }
    case CANCEL_REQUEST_CODE:
      return { packet: { kind: 'cancel-request' }, length }
    default:
      return { packet: { kind: 'startup', protocolVersion: code }, length }
  }
}

// Splits the complete frontend messages off the front of `buffer`. `rest` is
// prepended to the next chunk read from the socket.
export function splitMessages(buffer: Uint8Array): { messages: Uint8Array[]; rest: Uint8Array } {
  const messages: Uint8Array[] = []
  let offset = 0

  while (buffer.length - offset >= 5) {
    const length = readInt32(buffer, offset + 1)

    if (length < 4) {
      throw new ProtocolError(
        `Invalid length ${String(length)} for message type 0x${readUint8(buffer, offset).toString(16)}.`,
      )
    }

    const end = offset + 1 + length

    if (end > buffer.length) {
      break
    }

    messages.push(buffer.subarray(offset, end))
    offset = end
  }

  return { messages, rest: buffer.subarray(offset) }
}

// Yields the bounds of each backend message in a raw response.
function* backendMessages(
  response: Uint8Array,
): Generator<{ type: number; start: number; end: number }> {
  let offset = 0

  while (response.length - offset >= 5) {
    const end = offset + 1 + readInt32(response, offset + 1)

    if (end > response.length || end <= offset + 4) {
      return
    }

    yield { type: readUint8(response, offset), start: offset, end }
    offset = end
  }
}

// Status of the last ReadyForQuery in `response`, or undefined when there is
// none (the backend is still mid-pipeline, e.g. a Parse not yet followed by
// Sync).
export function lastReadyForQueryStatus(response: Uint8Array): TransactionStatus | undefined {
  let status: TransactionStatus | undefined

  for (const { type, start } of backendMessages(response)) {
    if (type === BackendMessage.ReadyForQuery) {
      status = TRANSACTION_STATUS[readUint8(response, start + 5)]
    }
  }

  return status
}

// Removes the NotificationResponse messages, which are broadcast separately.
export function stripNotifications(response: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = []
  let stripped = false

  for (const { type, start, end } of backendMessages(response)) {
    if (type === BackendMessage.NotificationResponse) {
      stripped = true
    } else {
      kept.push(response.subarray(start, end))
    }
  }

  return stripped ? concatBytes(...kept) : response
}

// Offset of the statement name in a frontend message, or undefined when it
// references none.
function statementNameOffset(message: Uint8Array): number | undefined {
  switch (message[0]) {
    case FrontendMessage.Parse:
      return 5
    case FrontendMessage.Bind: {
      // The statement name follows the portal name.
      const portalEnd = message.indexOf(0, 5)

      return portalEnd === -1 ? undefined : portalEnd + 1
    }
    case FrontendMessage.Describe:
    case FrontendMessage.Close:
      return message[5] === STATEMENT_KIND ? 6 : undefined
    default:
      return undefined
  }
}

// Prefixes the prepared-statement name in Parse, Bind, Describe ('S') and
// Close ('S'). Other messages and the unnamed statement (empty name) pass
// through. `name` is the rewritten name, set only when a rewrite happened.
export function rewriteStatementName(
  message: Uint8Array,
  { prefix }: { prefix: string },
): { message: Uint8Array; name?: string } {
  const start = statementNameOffset(message)

  if (start === undefined) {
    return { message }
  }

  const end = message.indexOf(0, start)

  if (end === -1 || end === start) {
    return { message }
  }

  const name = concatBytes(textEncoder.encode(prefix), message.subarray(start, end))
  const rewritten = buildMessage(
    readUint8(message, 0),
    message.subarray(5, start),
    name,
    message.subarray(end),
  )

  return { message: rewritten, name: textDecoder.decode(name) }
}

export function buildAuthenticationOk(): Uint8Array {
  return buildMessage(BackendMessage.Authentication, int32(0))
}

export function buildParameterStatus(name: string, value: string): Uint8Array {
  return buildMessage(BackendMessage.ParameterStatus, cString(name), cString(value))
}

export function buildBackendKeyData(processId: number, secretKey: number): Uint8Array {
  return buildMessage(BackendMessage.BackendKeyData, int32(processId), int32(secretKey))
}

export function buildReadyForQuery(status: TransactionStatus): Uint8Array {
  return buildMessage(BackendMessage.ReadyForQuery, new Uint8Array([status.charCodeAt(0)]))
}

function errorField(type: string, value: string): Uint8Array {
  return concatBytes(textEncoder.encode(type), cString(value))
}

// Fields: severity (S and V), SQLSTATE (C) and message (M), then a null byte.
export function buildErrorResponse({
  code,
  message,
  severity,
}: {
  code: string
  message: string
  severity: 'ERROR' | 'FATAL'
}): Uint8Array {
  return buildMessage(
    BackendMessage.ErrorResponse,
    errorField('S', severity),
    errorField('V', severity),
    errorField('C', code),
    errorField('M', message),
    new Uint8Array(1),
  )
}

export function buildNotificationResponse(
  channel: string,
  payload: string,
  processId = 0,
): Uint8Array {
  return buildMessage(
    BackendMessage.NotificationResponse,
    int32(processId),
    cString(channel),
    cString(payload),
  )
}

export function buildQuery(sql: string): Uint8Array {
  return buildMessage(FrontendMessage.Query, cString(sql))
}

export function buildCloseStatement(name: string): Uint8Array {
  return buildMessage(FrontendMessage.Close, new Uint8Array([STATEMENT_KIND]), cString(name))
}

export function buildSync(): Uint8Array {
  return buildMessage(FrontendMessage.Sync)
}
