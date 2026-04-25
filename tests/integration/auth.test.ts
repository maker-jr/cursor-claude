import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/http/app'
import {
  fakeAnthropicClient,
  fakeOAuthClient,
  fixedClock,
  inMemoryCredentialStore,
  silentLogger,
} from '../helpers/fake-deps'

const NOW = 1_000_000

function makeApp(overrides: any = {}) {
  return createApp({
    anthropic: fakeAnthropicClient(),
    oauth: overrides.oauth ?? fakeOAuthClient(),
    credentialStore:
      overrides.credentialStore ?? inMemoryCredentialStore(),
    clock: fixedClock(NOW),
    logger: silentLogger(),
    getExpectedApiKey: () => undefined,
  })
}

describe('auth routes (integration)', () => {
  it('/auth/status returns authenticated=false when there are no credentials', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/auth/status'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.authenticated).toBe(false)
  })

  it('/auth/status returns authenticated=true when a valid token exists', async () => {
    const store = inMemoryCredentialStore({
      'auth:anthropic': {
        type: 'oauth',
        refresh: 'r',
        access: 'a',
        expires: NOW + 60_000,
      },
    })
    const app = makeApp({ credentialStore: store })
    const res = await app.fetch(new Request('http://localhost/auth/status'))
    const json = (await res.json()) as any
    expect(json.authenticated).toBe(true)
  })

  it('/auth/oauth/start returns an auth URL and sessionId', async () => {
    const app = makeApp()
    const res = await app.fetch(
      new Request('http://localhost/auth/oauth/start', { method: 'POST' }),
    )
    const json = (await res.json()) as any
    expect(json.success).toBe(true)
    expect(typeof json.authUrl).toBe('string')
    expect(json.authUrl.startsWith('https://claude.ai/oauth/authorize')).toBe(
      true,
    )
    expect(typeof json.sessionId).toBe('string')
    expect(json.sessionId.length).toBeGreaterThan(10)
  })

  it('/auth/oauth/callback 400s when code is missing', async () => {
    const app = makeApp()
    const res = await app.fetch(
      new Request('http://localhost/auth/oauth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('/auth/oauth/callback persists tokens on happy path', async () => {
    const store = inMemoryCredentialStore()
    const app = makeApp({
      credentialStore: store,
      oauth: fakeOAuthClient({
        onExchange: () => ({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 60,
        }),
      }),
    })
    const res = await app.fetch(
      new Request('http://localhost/auth/oauth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'abc#verifier' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(store.data['auth:anthropic']?.access).toBe('at')
    expect(store.data['auth:anthropic']?.refresh).toBe('rt')
  })

  it('/auth/logout removes stored credentials', async () => {
    const store = inMemoryCredentialStore({
      'auth:anthropic': {
        type: 'oauth',
        refresh: 'r',
        access: 'a',
        expires: NOW + 1_000,
      },
    })
    const app = makeApp({ credentialStore: store })
    const res = await app.fetch(new Request('http://localhost/auth/logout'))
    expect(res.status).toBe(200)
    expect(store.data['auth:anthropic']).toBeUndefined()
  })
})
