import type { OAuthCredentials } from '../domain/auth/token-lifecycle'

export interface CredentialStore {
  get(key: string): Promise<OAuthCredentials | null>
  set(key: string, credentials: OAuthCredentials): Promise<void>
  del(key: string): Promise<void>
}

export type { OAuthCredentials }
