import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/http/app'
import {
  fakeAnthropicClient,
  fakeOAuthClient,
  fixedClock,
  inMemoryCredentialStore,
  silentLogger,
} from '../helpers/fake-deps'

function makeApp() {
  return createApp({
    anthropic: fakeAnthropicClient(),
    oauth: fakeOAuthClient(),
    credentialStore: inMemoryCredentialStore(),
    clock: fixedClock(1),
    logger: silentLogger(),
    getExpectedApiKey: () => undefined,
  })
}

describe('root routes (integration)', () => {
  it('/ returns HTML (either public/index.html or the CLI fallback)', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const body = await res.text()
    expect(body).toMatch(/<html/i)
  })

  it('/index.html returns the same document as /', async () => {
    const app = makeApp()
    const a = await app.fetch(new Request('http://localhost/'))
    const b = await app.fetch(new Request('http://localhost/index.html'))
    expect(await a.text()).toBe(await b.text())
  })
})
