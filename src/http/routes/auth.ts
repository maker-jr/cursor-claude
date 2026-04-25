import type { Context, Hono } from 'hono'
import { decideTokenAction } from '../../domain/auth/token-lifecycle'
import { generatePKCE, getAuthorizationUrl } from '../../domain/auth/pkce'
import type {
  ErrorResponse,
  SuccessResponse,
} from '../../domain/proxy/types'
import type { Clock } from '../../ports/clock'
import type { CredentialStore } from '../../ports/credential-store'
import type { Logger } from '../../ports/logger'
import type { OAuthClient } from '../../ports/oauth-client'
import { getClientId, REDIRECT_URI } from '../../adapters/oauth/http-client'

const AUTH_KEY = 'auth:anthropic'

export interface AuthDeps {
  credentialStore: CredentialStore
  oauth: OAuthClient
  clock: Clock
  logger: Logger
}

export function registerAuthRoutes(app: Hono, deps: AuthDeps): void {
  app.post('/auth/oauth/start', async (c: Context) => {
    try {
      const pkce = generatePKCE()
      const authUrl = getAuthorizationUrl({
        clientId: getClientId(),
        redirectUri: REDIRECT_URI,
        pkce,
      })
      return c.json({
        success: true,
        authUrl,
        sessionId: pkce.verifier,
      })
    } catch (err) {
      return c.json<ErrorResponse>(
        {
          error: 'Failed to start OAuth flow',
          message: (err as Error).message,
        },
        500,
      )
    }
  })

  app.post('/auth/oauth/callback', async (c: Context) => {
    try {
      const body = await c.req.json()
      const { code } = body as { code?: string }
      if (!code) {
        return c.json<ErrorResponse>(
          {
            error: 'Missing OAuth code',
            message: 'OAuth code is required',
          },
          400,
        )
      }

      const splits = code.split('#')
      const verifier = splits[1] || ''

      const tokens = await deps.oauth.exchangeCode(code, verifier)
      const expires = deps.clock.now() + tokens.expires_in * 1000
      await deps.credentialStore.set(AUTH_KEY, {
        type: 'oauth',
        refresh: tokens.refresh_token,
        access: tokens.access_token,
        expires,
      })

      return c.json<SuccessResponse>({
        success: true,
        message: 'OAuth authentication successful',
      })
    } catch (err) {
      return c.json<ErrorResponse>(
        {
          error: 'OAuth callback failed',
          message: (err as Error).message,
        },
        500,
      )
    }
  })

  // Legacy: POST /auth/login/start. The CLI doesn't use this, but Vercel
  // deployments that predate the CLI still might.
  app.post('/auth/login/start', async (c: Context) => {
    try {
      const credentials = await deps.credentialStore.get(AUTH_KEY)
      const decision = decideTokenAction(credentials, deps.clock.now())
      if (decision.kind === 'valid') {
        return c.json<SuccessResponse>({
          success: true,
          message: 'OAuth authentication successful',
        })
      }
      return c.json<SuccessResponse>(
        { success: false, message: 'OAuth authentication failed' },
        401,
      )
    } catch (err) {
      return c.json<SuccessResponse>(
        { success: false, message: (err as Error).message },
        500,
      )
    }
  })

  app.get('/auth/logout', async (c: Context) => {
    try {
      await deps.credentialStore.del(AUTH_KEY)
      return c.json<SuccessResponse>({
        success: true,
        message: 'Logged out successfully',
      })
    } catch (err) {
      return c.json<SuccessResponse>(
        { success: false, message: (err as Error).message },
        500,
      )
    }
  })

  app.get('/auth/status', async (c: Context) => {
    try {
      const credentials = await deps.credentialStore.get(AUTH_KEY)
      const decision = decideTokenAction(credentials, deps.clock.now())
      // The legacy endpoint returned true when there was a valid token OR
      // we could refresh. Preserve that behavior.
      const authenticated =
        decision.kind === 'valid' || decision.kind === 'needs-refresh'
      return c.json({ authenticated })
    } catch {
      return c.json({ authenticated: false })
    }
  })
}
