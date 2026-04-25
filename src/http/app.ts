import { Hono } from 'hono'
import type { AnthropicClient } from '../ports/anthropic-client'
import type { Clock } from '../ports/clock'
import type { CredentialStore } from '../ports/credential-store'
import type { Logger } from '../ports/logger'
import type { OAuthClient } from '../ports/oauth-client'
import { corsMiddleware, corsPreflightHandler } from './middleware/cors'
import { requestLogMiddleware } from './middleware/request-log'
import { registerAuthRoutes } from './routes/auth'
import { registerMessagesRoutes } from './routes/messages'
import { registerModelsRoutes } from './routes/models'
import { registerRootRoutes } from './routes/root'

export interface AppDeps {
  anthropic: AnthropicClient
  oauth: OAuthClient
  credentialStore: CredentialStore
  clock: Clock
  logger: Logger
  // Dynamic so `start` can install the resolved API key after construction.
  getExpectedApiKey: () => string | undefined
}

// Build a fully wired Hono app from an injected Deps object. No globals, no
// module-level side effects.
export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.options('*', corsPreflightHandler)
  app.use('*', corsMiddleware)
  app.use('*', requestLogMiddleware(deps.logger))

  registerRootRoutes(app)
  registerAuthRoutes(app, {
    credentialStore: deps.credentialStore,
    oauth: deps.oauth,
    clock: deps.clock,
    logger: deps.logger,
  })
  registerModelsRoutes(app, {
    anthropic: deps.anthropic,
    logger: deps.logger,
  })
  registerMessagesRoutes(app, {
    anthropic: deps.anthropic,
    credentialStore: deps.credentialStore,
    oauth: deps.oauth,
    clock: deps.clock,
    logger: deps.logger,
    getExpectedApiKey: deps.getExpectedApiKey,
  })

  return app
}
