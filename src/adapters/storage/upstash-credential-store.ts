import { Redis as UpstashRedis } from '@upstash/redis'
import type {
  CredentialStore,
  OAuthCredentials,
} from '../../ports/credential-store'

export function createUpstashCredentialStore(
  restUrl: string,
  restToken: string,
): CredentialStore {
  const upstash = new UpstashRedis({ url: restUrl, token: restToken })
  return {
    get: (key) => upstash.get<OAuthCredentials>(key),
    set: async (key, credentials) => {
      await upstash.set(key, credentials)
    },
    del: async (key) => {
      await upstash.del(key)
    },
  }
}
