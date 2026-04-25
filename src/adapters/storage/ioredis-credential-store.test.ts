import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture how ioredis was constructed and what methods got called so the test
// can assert without touching a real Redis.
type Calls = {
  ctor: Array<unknown[]>
  get: Array<unknown[]>
  set: Array<unknown[]>
  del: Array<unknown[]>
}

const calls: Calls = { ctor: [], get: [], set: [], del: [] }
let nextGetReturn: string | null = null

vi.mock('ioredis', () => {
  return {
    default: class FakeIORedis {
      constructor(...args: unknown[]) {
        calls.ctor.push(args)
      }
      async get(...args: unknown[]) {
        calls.get.push(args)
        return nextGetReturn
      }
      async set(...args: unknown[]) {
        calls.set.push(args)
        return 'OK'
      }
      async del(...args: unknown[]) {
        calls.del.push(args)
        return 1
      }
    },
  }
})

import { createIoRedisCredentialStore } from './ioredis-credential-store'

const KEY = 'auth:anthropic'
const CREDS = {
  type: 'oauth' as const,
  refresh: 'r-token',
  access: 'a-token',
  expires: 1_700_000_000_000,
}

describe('createIoRedisCredentialStore', () => {
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

  it('passes the redis URL and retry config to the ioredis constructor', () => {
    createIoRedisCredentialStore('redis://localhost:6379')
    expect(calls.ctor).toHaveLength(1)
    expect(calls.ctor[0][0]).toBe('redis://localhost:6379')
    expect(calls.ctor[0][1]).toMatchObject({ maxRetriesPerRequest: 3 })
  })

  it('returns null when the key is missing', async () => {
    const store = createIoRedisCredentialStore('redis://localhost:6379')
    nextGetReturn = null
    await expect(store.get(KEY)).resolves.toBeNull()
    expect(calls.get).toEqual([[KEY]])
  })

  it('parses stored JSON on get', async () => {
    const store = createIoRedisCredentialStore('redis://localhost:6379')
    nextGetReturn = JSON.stringify(CREDS)
    await expect(store.get(KEY)).resolves.toEqual(CREDS)
  })

  it('serializes credentials as JSON on set', async () => {
    const store = createIoRedisCredentialStore('redis://localhost:6379')
    await store.set(KEY, CREDS)
    expect(calls.set).toEqual([[KEY, JSON.stringify(CREDS)]])
  })

  it('forwards del to the underlying client', async () => {
    const store = createIoRedisCredentialStore('redis://localhost:6379')
    await store.del(KEY)
    expect(calls.del).toEqual([[KEY]])
  })
})
