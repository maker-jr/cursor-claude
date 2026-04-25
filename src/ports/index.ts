export type { CredentialStore, OAuthCredentials } from './credential-store'
export type { ConfigStore } from './config-store'
export type {
  AnthropicClient,
  AnthropicFetchOptions,
  AnthropicFetchResponse,
} from './anthropic-client'
export type { OAuthClient, OAuthTokenResponse } from './oauth-client'
export type { TunnelHandle, TunnelFactory } from './tunnel'
export type { Clock } from './clock'
export type { Logger } from './logger'

import type { CredentialStore } from './credential-store'
import type { ConfigStore } from './config-store'
import type { AnthropicClient } from './anthropic-client'
import type { OAuthClient } from './oauth-client'
import type { TunnelFactory } from './tunnel'
import type { Clock } from './clock'
import type { Logger } from './logger'

// Composition root shape: every adapter the app needs, injected at the edges.
export interface Deps {
  credentialStore: CredentialStore
  configStore: ConfigStore
  anthropic: AnthropicClient
  oauth: OAuthClient
  makeTunnel: TunnelFactory
  clock: Clock
  logger: Logger
}
