import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/http/app'
import {
  fakeAnthropicClient,
  fakeOAuthClient,
  fixedClock,
  inMemoryCredentialStore,
  silentLogger,
} from '../helpers/fake-deps'

const modelsDev = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'models-dev.json'), 'utf8'),
)

function buildApp(anthropic = fakeAnthropicClient({ models: modelsDev })) {
  return createApp({
    anthropic,
    oauth: fakeOAuthClient(),
    credentialStore: inMemoryCredentialStore(),
    clock: fixedClock(1_000_000),
    logger: silentLogger(),
    getExpectedApiKey: () => 'test-key',
  })
}

describe('GET /v1/models (integration)', () => {
  it('returns an OpenAI-shaped models list, sorted newest first', async () => {
    const app = buildApp()
    const res = await app.fetch(new Request('http://localhost/v1/models'))
    expect(res.status).toBe(200)
    const data = (await res.json()) as any
    expect(data.object).toBe('list')
    expect(Array.isArray(data.data)).toBe(true)
    expect(data.data.length).toBeGreaterThan(0)
    // Each model should have id/object/created/owned_by.
    for (const m of data.data) {
      expect(m.object).toBe('model')
      expect(m.owned_by).toBe('anthropic')
      expect(typeof m.id).toBe('string')
      expect(typeof m.created).toBe('number')
    }
    // Sorted newest first.
    for (let i = 1; i < data.data.length; i++) {
      expect(data.data[i - 1].created).toBeGreaterThanOrEqual(data.data[i].created)
    }
  })

  it('returns an empty list when the upstream has no Anthropic models', async () => {
    const app = buildApp(fakeAnthropicClient({ models: { anthropic: null } }))
    const res = await app.fetch(new Request('http://localhost/v1/models'))
    expect(res.status).toBe(200)
    const data = (await res.json()) as any
    expect(data.data).toEqual([])
  })

  it('returns 500 when the upstream throws', async () => {
    const app = buildApp({
      async sendMessages() {
        throw new Error('not used')
      },
      async fetchModels() {
        throw new Error('models.dev down')
      },
    })
    const res = await app.fetch(new Request('http://localhost/v1/models'))
    expect(res.status).toBe(500)
    const data = (await res.json()) as any
    expect(data.error).toBe('Proxy error')
  })
})
