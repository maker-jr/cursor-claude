import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Calls = {
  ctor: Array<{ url: string; token: string }>
  get: Array<unknown[]>
  set: Array<unknown[]>
  del: Array<unknown[]>
}

const calls: Calls = { ctor: [], get: [], set: [], del: [] }
let nextGetReturn: unknown = null

vi.mock('@upstash/redis', () => {
  return {
    Redis: class FakeUpstashRedis {
      constructor(opts: { url: string; token: string }) {
        calls.ctor.push(opts)
      }
      async get(key: string) {
        calls.get.push([key])
        return nextGetReturn
      }
      async set(key: string, value: unknown) {
        calls.set.push([key, value])
        return 'OK'
      }
      async del(key: string) {
        calls.del.push([key])
        return 1
      }
    },
  }
})

import { createUpstashCredentialStore } from './upstash-credential-store'

const KEY = 'auth:anthropic'
const CREDS = {
  type: 'oauth' as const,
  refresh: 'r-token',
  access: 'a-token',
  expires: 1_700_000_000_000,
}

describe('createUpstashCredentialStore', () => {
  beforeEach(() => {
    calls.ctor.length = 0
    calls.get.length = 0
    calls.set.length = 0
    calls.del.length = 0
    nextGetReturn = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('passes url + token to the Upstash constructor', () => {
    createUpstashCredentialStore('https://example.upstash.io', 'tk_secret')
    expect(calls.ctor).toEqual([
      { url: 'https://example.upstash.io', token: 'tk_secret' },
    ])
  })

  it('returns null when the key is missing', async () => {
    const store = createUpstashCredentialStore('https://x', 't')
    nextGetReturn = null
    await expect(store.get(KEY)).resolves.toBeNull()
    expect(calls.get).toEqual([[KEY]])
  })

  it('returns the stored object on get (Upstash deserializes for us)', async () => {
    const store = createUpstashCredentialStore('https://x', 't')
    nextGetReturn = CREDS
    await expect(store.get(KEY)).resolves.toEqual(CREDS)
  })

  it('passes the credentials object directly to set (Upstash handles JSON)', async () => {
    const store = createUpstashCredentialStore('https://x', 't')
    await store.set(KEY, CREDS)
    expect(calls.set).toEqual([[KEY, CREDS]])
  })

  it('forwards del to the underlying client', async () => {
    const store = createUpstashCredentialStore('https://x', 't')
    await store.del(KEY)
    expect(calls.del).toEqual([[KEY]])
  })
})
