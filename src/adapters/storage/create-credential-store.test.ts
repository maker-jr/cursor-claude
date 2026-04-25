import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We don't want the test to actually open a Redis connection, so stub the
// underlying clients before the factory imports them.
vi.mock('ioredis', () => ({
  default: class FakeIORedis {
    constructor(_url: string, _opts?: unknown) {}
    async get() { return null }
    async set() { return 'OK' }
    async del() { return 0 }
  },
}))

vi.mock('@upstash/redis', () => ({
  Redis: class FakeUpstash {
    constructor(_opts: unknown) {}
    async get() { return null }
    async set() { return 'OK' }
    async del() { return 0 }
  },
}))

import {
  getCredentialStore,
  resetCredentialStoreCache,
} from './create-credential-store'

describe('getCredentialStore', () => {
  let tempRoot: string
  let savedXdg: string | undefined
  let savedRedisUrl: string | undefined
  let savedUpstashUrl: string | undefined
  let savedUpstashToken: string | undefined

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'cc-create-store-'))
    savedXdg = process.env.XDG_CONFIG_HOME
    savedRedisUrl = process.env.REDIS_URL
    savedUpstashUrl = process.env.UPSTASH_REDIS_REST_URL
    savedUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
    process.env.XDG_CONFIG_HOME = tempRoot
    delete process.env.REDIS_URL
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    resetCredentialStoreCache()
  })

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
    if (savedRedisUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = savedRedisUrl
    if (savedUpstashUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
    else process.env.UPSTASH_REDIS_REST_URL = savedUpstashUrl
    if (savedUpstashToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
    else process.env.UPSTASH_REDIS_REST_TOKEN = savedUpstashToken
    resetCredentialStoreCache()
    rmSync(tempRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('returns the file-backed store by default', () => {
    const info = getCredentialStore()
    expect(info.kind).toBe('file')
    expect(typeof info.store.get).toBe('function')
  })

  it('returns the ioredis-backed store when REDIS_URL is set', () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    resetCredentialStoreCache()
    const info = getCredentialStore()
    expect(info.kind).toBe('redis')
  })

  it('returns the upstash-backed store when only the Upstash env vars are set', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tk_secret'
    resetCredentialStoreCache()
    const info = getCredentialStore()
    expect(info.kind).toBe('upstash')
  })

  it('prefers ioredis over Upstash when both are set', () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tk_secret'
    resetCredentialStoreCache()
    const info = getCredentialStore()
    expect(info.kind).toBe('redis')
  })

  it('memoizes the store across calls until reset', () => {
    const a = getCredentialStore()
    const b = getCredentialStore()
    expect(a).toBe(b)
    resetCredentialStoreCache()
    const c = getCredentialStore()
    expect(c).not.toBe(a)
  })

  it('falls back to file when only one half of the Upstash pair is set', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    // missing token
    resetCredentialStoreCache()
    expect(getCredentialStore().kind).toBe('file')
  })
})
