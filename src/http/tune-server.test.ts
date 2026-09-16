import { describe, expect, it } from 'vitest'
import { isClientDisconnectError } from './tune-server'

function withCode(message: string, code: string): Error {
  const err = new Error(message) as NodeJS.ErrnoException
  err.code = code
  return err
}

describe('isClientDisconnectError', () => {
  it('recognizes the http server abortIncoming error', () => {
    // Exactly what Node raises when the inbound socket resets mid-request.
    expect(isClientDisconnectError(withCode('aborted', 'ECONNRESET'))).toBe(
      true,
    )
  })

  it('recognizes bare disconnect codes', () => {
    expect(isClientDisconnectError(withCode('write EPIPE', 'EPIPE'))).toBe(true)
    expect(
      isClientDisconnectError(
        withCode('Premature close', 'ERR_STREAM_PREMATURE_CLOSE'),
      ),
    ).toBe(true)
  })

  it('recognizes a message-only aborted error', () => {
    expect(isClientDisconnectError(new Error('aborted'))).toBe(true)
  })

  it('does not swallow unrelated errors', () => {
    expect(isClientDisconnectError(new Error('boom'))).toBe(false)
    expect(
      isClientDisconnectError(withCode('address in use', 'EADDRINUSE')),
    ).toBe(false)
    expect(isClientDisconnectError('aborted')).toBe(false)
    expect(isClientDisconnectError(undefined)).toBe(false)
  })
})
