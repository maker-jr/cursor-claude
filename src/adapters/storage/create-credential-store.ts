import type { CredentialStore } from '../../ports/credential-store'
import { createFileCredentialStore } from './file-credential-store'
import { createIoRedisCredentialStore } from './ioredis-credential-store'
import { createUpstashCredentialStore } from './upstash-credential-store'

export type StorageKind = 'redis' | 'upstash' | 'file'

export interface StoreInfo {
  kind: StorageKind
  store: CredentialStore
}

let cached: StoreInfo | null = null

// Lazy factory. Mirrors env-var precedence: REDIS_URL > UPSTASH_REST > file.
// Memoized so repeated callers share the same client (avoids Redis pool churn).
export function getCredentialStore(): StoreInfo {
  if (cached) return cached

  const redisUrl = process.env.REDIS_URL
  if (redisUrl && redisUrl.length > 0) {
    cached = {
      kind: 'redis',
      store: createIoRedisCredentialStore(redisUrl),
    }
    return cached
  }

  const restUrl = process.env.UPSTASH_REDIS_REST_URL
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (restUrl && restToken) {
    cached = {
      kind: 'upstash',
      store: createUpstashCredentialStore(restUrl, restToken),
    }
    return cached
  }

  cached = { kind: 'file', store: createFileCredentialStore() }
  return cached
}

// Test hook: clear the cached store so tests can flip env and re-create.
export function resetCredentialStoreCache(): void {
  cached = null
}
