import IORedis from 'ioredis'
import type {
  CredentialStore,
  OAuthCredentials,
} from '../../ports/credential-store'

export function createIoRedisCredentialStore(
  redisUrl: string,
): CredentialStore {
  const client = new IORedis(redisUrl, { maxRetriesPerRequest: 3 })
  return {
    async get(key) {
      const raw = await client.get(key)
      if (raw == null) return null
      return JSON.parse(raw) as OAuthCredentials
    },
    async set(key, credentials) {
      await client.set(key, JSON.stringify(credentials))
    },
    async del(key) {
      await client.del(key)
    },
  }
}
