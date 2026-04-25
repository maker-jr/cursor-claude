import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpOAuthClient } from './http-client'

describe('createHttpOAuthClient', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('exchangeCode posts JSON body with code, verifier, grant_type, client_id', async () => {
    let body: any = null
    globalThis.fetch = vi.fn(async (_u, init: any) => {
      body = JSON.parse(init.body)
      return new Response(
        JSON.stringify({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const client = createHttpOAuthClient({
      clientId: 'client-id',
      tokenUrl: 'https://example.test/oauth/token',
      redirectUri: 'https://example.test/cb',
    })

    const res = await client.exchangeCode('abc123#state-part', 'verifier-val')
    expect(res.access_token).toBe('at')
    expect(body.code).toBe('abc123')
    expect(body.state).toBe('state-part')
    expect(body.grant_type).toBe('authorization_code')
    expect(body.client_id).toBe('client-id')
    expect(body.code_verifier).toBe('verifier-val')
    expect(body.redirect_uri).toBe('https://example.test/cb')
  })

  it('exchangeCode throws on non-OK response', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('nope', { status: 400 })
    }) as unknown as typeof fetch
    const client = createHttpOAuthClient()
    await expect(client.exchangeCode('c', 'v')).rejects.toThrow(/nope/)
  })

  it('refreshToken posts grant_type=refresh_token and returns tokens', async () => {
    let body: any = null
    globalThis.fetch = vi.fn(async (_u, init: any) => {
      body = JSON.parse(init.body)
      return new Response(
        JSON.stringify({
          access_token: 'new-at',
          refresh_token: 'new-rt',
          expires_in: 60,
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = createHttpOAuthClient({
      clientId: 'cid',
      tokenUrl: 'https://example.test/t',
    })
    const res = await client.refreshToken('old-rt')
    expect(res.access_token).toBe('new-at')
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('old-rt')
    expect(body.client_id).toBe('cid')
  })

  it('refreshToken throws on non-OK response', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('invalid_grant', { status: 400 })
    }) as unknown as typeof fetch
    const client = createHttpOAuthClient()
    await expect(client.refreshToken('x')).rejects.toThrow(/invalid_grant/)
  })
})
