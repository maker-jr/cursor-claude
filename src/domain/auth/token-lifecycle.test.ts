import { describe, expect, it } from 'vitest'
import { decideTokenAction } from './token-lifecycle'

describe('decideTokenAction', () => {
  it('returns missing when credentials are null', () => {
    expect(decideTokenAction(null, 1_000)).toEqual({ kind: 'missing' })
  })

  it('returns valid when access token is not yet expired', () => {
    const creds = {
      type: 'oauth' as const,
      refresh: 'r',
      access: 'a',
      expires: 2_000,
    }
    expect(decideTokenAction(creds, 1_000)).toEqual({
      kind: 'valid',
      accessToken: 'a',
    })
  })

  it('returns needs-refresh when expired and refresh token exists', () => {
    const creds = {
      type: 'oauth' as const,
      refresh: 'r',
      access: 'a',
      expires: 500,
    }
    expect(decideTokenAction(creds, 1_000)).toEqual({
      kind: 'needs-refresh',
      refreshToken: 'r',
    })
  })

  it('returns expired-no-refresh when expired and refresh is empty', () => {
    const creds = {
      type: 'oauth' as const,
      refresh: '',
      access: 'a',
      expires: 500,
    }
    expect(decideTokenAction(creds, 1_000)).toEqual({
      kind: 'expired-no-refresh',
    })
  })

  it('returns missing when type is not oauth (defensive)', () => {
    // @ts-expect-error testing defensive branch
    expect(decideTokenAction({ type: 'other' }, 1_000)).toEqual({
      kind: 'missing',
    })
  })
})
