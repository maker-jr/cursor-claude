import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generatePKCE, getAuthorizationUrl } from './pkce'

describe('generatePKCE', () => {
  it('creates verifier+challenge where challenge = SHA-256(verifier) base64url', () => {
    const pkce = generatePKCE()
    // verifier is 32 random bytes encoded base64url (~43 characters).
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(40)
    const expected = crypto
      .createHash('sha256')
      .update(pkce.verifier)
      .digest('base64url')
    expect(pkce.challenge).toBe(expected)
  })

  it('returns different verifiers across calls', () => {
    const a = generatePKCE()
    const b = generatePKCE()
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('getAuthorizationUrl', () => {
  it('includes clientId, redirect_uri, pkce challenge + state, and the OAuth scopes', () => {
    const pkce = { verifier: 'verif', challenge: 'chal' }
    const url = new URL(
      getAuthorizationUrl({
        clientId: 'client-id',
        redirectUri: 'https://example.test/callback',
        pkce,
      }),
    )
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://example.test/callback',
    )
    expect(url.searchParams.get('code_challenge')).toBe('chal')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('verif')
    expect(url.searchParams.get('scope')).toMatch(/user:inference/)
  })
})
