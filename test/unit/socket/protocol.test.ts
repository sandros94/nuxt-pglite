import { describe, expect, test } from 'vitest'

import {
  ProtocolError,
  buildCloseStatement,
  buildNotificationResponse,
  buildQuery,
  buildReadyForQuery,
  buildSync,
  concatBytes,
  lastReadyForQueryStatus,
  readStartupPacket,
  rewriteStatementName,
  splitMessages,
  stripNotifications,
} from '../../../src/runtime/socket/protocol'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const int32 = (value: number) => {
  const bytes = new Uint8Array(4)

  new DataView(bytes.buffer).setInt32(0, value)

  return bytes
}

const int16 = (value: number) => {
  const bytes = new Uint8Array(2)

  new DataView(bytes.buffer).setInt16(0, value)

  return bytes
}

const cString = (value: string) => concatBytes(encoder.encode(value), new Uint8Array(1))

const message = (type: string, ...body: Uint8Array[]) => {
  const payload = concatBytes(...body)

  return concatBytes(encoder.encode(type), int32(4 + payload.length), payload)
}

const lengthOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset).getInt32(1)

const parse = (name: string, sql: string) => message('P', cString(name), cString(sql), int16(0))
const bind = (portal: string, statement: string) =>
  message('B', cString(portal), cString(statement), int16(0), int16(0), int16(0))

const packet = (code: number, ...body: Uint8Array[]) => {
  const payload = concatBytes(int32(code), ...body)

  return concatBytes(int32(4 + payload.length), payload)
}

describe('readStartupPacket', () => {
  test('detects SSL, GSSENC and cancel requests', () => {
    expect(readStartupPacket(packet(80877103))).toEqual({
      packet: { kind: 'ssl-request' },
      length: 8,
    })
    expect(readStartupPacket(packet(80877104))).toEqual({
      packet: { kind: 'gssenc-request' },
      length: 8,
    })
    expect(readStartupPacket(packet(80877102, int32(1), int32(2)))).toEqual({
      packet: { kind: 'cancel-request' },
      length: 16,
    })
  })

  test('detects a startup message and its protocol version', () => {
    const startup = packet(196608, cString('user'), cString('postgres'), new Uint8Array(1))

    expect(readStartupPacket(startup)).toEqual({
      packet: { kind: 'startup', protocolVersion: 196608 },
      length: startup.length,
    })
  })

  test('waits until the whole packet has arrived', () => {
    const startup = packet(196608, cString('user'), cString('postgres'), new Uint8Array(1))

    expect(readStartupPacket(startup.subarray(0, 3))).toBeUndefined()
    expect(readStartupPacket(startup.subarray(0, startup.length - 1))).toBeUndefined()
  })

  test('rejects invalid lengths', () => {
    expect(() => readStartupPacket(int32(4))).toThrow(ProtocolError)
    expect(() => readStartupPacket(int32(1_000_000))).toThrow(ProtocolError)
  })
})

describe('splitMessages', () => {
  test('frames messages across chunk boundaries', () => {
    const stream = concatBytes(parse('', 'SELECT 1'), bind('', ''), buildSync())
    const received: Uint8Array[] = []
    let buffer: Uint8Array = new Uint8Array(0)

    // Feed the stream in 3-byte chunks, so both the headers and the bodies are split.
    for (let offset = 0; offset < stream.length; offset += 3) {
      buffer = concatBytes(buffer, stream.subarray(offset, offset + 3))

      const { messages, rest } = splitMessages(buffer)

      received.push(...messages)
      buffer = rest
    }

    expect(buffer).toHaveLength(0)
    expect(received.map((bytes) => decoder.decode(bytes.subarray(0, 1)))).toEqual(['P', 'B', 'S'])
    expect(concatBytes(...received)).toEqual(stream)
  })

  test('keeps an incomplete trailing message as the rest', () => {
    const sync = buildSync()
    const query = buildQuery('SELECT 1')
    const { messages, rest } = splitMessages(concatBytes(sync, query.subarray(0, 7)))

    expect(messages).toEqual([sync])
    expect(rest).toEqual(query.subarray(0, 7))
  })

  test('rejects a length shorter than the length field itself', () => {
    expect(() => splitMessages(concatBytes(encoder.encode('Q'), int32(3)))).toThrow(ProtocolError)
  })
})

describe('rewriteStatementName', () => {
  const prefix = '7_'

  test('prefixes the statement name of a Parse', () => {
    const { message: rewritten, name } = rewriteStatementName(parse('stmt', 'SELECT $1'), {
      prefix,
    })

    expect(name).toBe('7_stmt')
    expect(rewritten).toEqual(parse('7_stmt', 'SELECT $1'))
    expect(lengthOf(rewritten)).toBe(rewritten.length - 1)
  })

  test('prefixes the statement name of a Bind, not the portal name', () => {
    const { message: rewritten, name } = rewriteStatementName(bind('portal', 'stmt'), { prefix })

    expect(name).toBe('7_stmt')
    expect(rewritten).toEqual(bind('portal', '7_stmt'))
    expect(lengthOf(rewritten)).toBe(rewritten.length - 1)
  })

  test('prefixes Describe and Close of a statement', () => {
    const describeStatement = message('D', encoder.encode('S'), cString('stmt'))
    const closeStatement = message('C', encoder.encode('S'), cString('stmt'))

    expect(rewriteStatementName(describeStatement, { prefix })).toEqual({
      message: message('D', encoder.encode('S'), cString('7_stmt')),
      name: '7_stmt',
    })
    expect(rewriteStatementName(closeStatement, { prefix })).toEqual({
      message: buildCloseStatement('7_stmt'),
      name: '7_stmt',
    })
  })

  test('leaves Describe and Close of a portal untouched', () => {
    const describePortal = message('D', encoder.encode('P'), cString('portal'))
    const closePortal = message('C', encoder.encode('P'), cString('portal'))

    expect(rewriteStatementName(describePortal, { prefix })).toEqual({ message: describePortal })
    expect(rewriteStatementName(closePortal, { prefix })).toEqual({ message: closePortal })
  })

  test('leaves the unnamed statement untouched', () => {
    const unnamedParse = parse('', 'SELECT 1')
    const unnamedBind = bind('portal', '')

    expect(rewriteStatementName(unnamedParse, { prefix }).message).toBe(unnamedParse)
    expect(rewriteStatementName(unnamedBind, { prefix }).message).toBe(unnamedBind)
  })

  test('leaves other messages untouched', () => {
    const query = buildQuery('SELECT 1')

    expect(rewriteStatementName(query, { prefix })).toEqual({ message: query })
  })
})

describe('backend responses', () => {
  const commandComplete = message('C', cString('SELECT 1'))
  const notification = buildNotificationResponse('channel', 'payload')

  test('stripNotifications removes every NotificationResponse', () => {
    const response = concatBytes(
      notification,
      commandComplete,
      notification,
      buildReadyForQuery('I'),
    )

    expect(stripNotifications(response)).toEqual(
      concatBytes(commandComplete, buildReadyForQuery('I')),
    )
  })

  test('stripNotifications returns a response without notifications as is', () => {
    const response = concatBytes(commandComplete, buildReadyForQuery('I'))

    expect(stripNotifications(response)).toBe(response)
  })

  test('lastReadyForQueryStatus reads the status of the last ReadyForQuery', () => {
    expect(lastReadyForQueryStatus(concatBytes(commandComplete, buildReadyForQuery('T')))).toBe('T')
    expect(
      lastReadyForQueryStatus(concatBytes(buildReadyForQuery('T'), buildReadyForQuery('E'))),
    ).toBe('E')
    expect(
      lastReadyForQueryStatus(concatBytes(buildReadyForQuery('E'), buildReadyForQuery('I'))),
    ).toBe('I')
  })

  test('lastReadyForQueryStatus returns undefined without a ReadyForQuery', () => {
    expect(lastReadyForQueryStatus(message('1'))).toBeUndefined()
    expect(lastReadyForQueryStatus(new Uint8Array(0))).toBeUndefined()
  })

  test('buildNotificationResponse encodes the wire format', () => {
    expect(buildNotificationResponse('ch', 'hi', 3)).toEqual(
      message('A', int32(3), cString('ch'), cString('hi')),
    )
    expect(decoder.decode(notification.subarray(9, 16))).toBe('channel')
  })
})
