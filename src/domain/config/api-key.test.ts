import { describe, expect, it } from 'vitest'
import { generateApiKey, resolveApiKey } from './api-key'
import type { ConfigStore } from '../../ports/config-store'

function memConfigStore(initial?: string): ConfigStore & { key?: string } {
  const state: { key?: string } = { key: initial }
  return {
    async getApiKey() {
      return state.key
    },
    async setApiKey(k) {
      state.key = k
    },
    get key() {
      return state.key
    },
  }
}

describe('generateApiKey', () => {
  it('has the cck_ prefix and enough entropy', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a).toMatch(/^cck_/)
    expect(a.length).toBeGreaterThanOrEqual(40)
    expect(a).not.toBe(b)
  })
})

describe('resolveApiKey', () => {
  it('flag wins and is persisted', async () => {
    const store = memConfigStore()
    const r = await resolveApiKey({
      flag: 'flag-key',
      envValue: 'env-key',
      configStore: store,
    })
    expect(r).toEqual({ value: 'flag-key', source: 'flag' })
    expect(store.key).toBe('flag-key')
  })

  it('env wins over persisted and is NOT persisted', async () => {
    const store = memConfigStore('persisted-key')
    const r = await resolveApiKey({
      envValue: 'env-key',
      configStore: store,
    })
    expect(r).toEqual({ value: 'env-key', source: 'env' })
    expect(store.key).toBe('persisted-key')
  })

  it('falls back to persisted when neither flag nor env set', async () => {
    const store = memConfigStore('persisted-key')
    const r = await resolveApiKey({ configStore: store })
    expect(r).toEqual({ value: 'persisted-key', source: 'persisted' })
  })

  it('generates and persists when nothing is set', async () => {
    const store = memConfigStore()
    const r = await resolveApiKey({ configStore: store })
    expect(r.source).toBe('generated')
    expect(r.value).toMatch(/^cck_/)
    expect(store.key).toBe(r.value)
  })

  it('treats empty string flag/env as absent', async () => {
    const store = memConfigStore('persisted-key')
    const r = await resolveApiKey({
      flag: '',
      envValue: '',
      configStore: store,
    })
    expect(r.source).toBe('persisted')
  })
})
