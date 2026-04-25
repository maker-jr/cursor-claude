import type {
  OAuthClient,
  OAuthTokenResponse,
} from '../../ports/oauth-client'

const DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
export const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'

export function getClientId(): string {
  return process.env.ANTHROPIC_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID
}

export function createHttpOAuthClient(opts?: {
  clientId?: string
  tokenUrl?: string
  redirectUri?: string
}): OAuthClient {
  const clientId = opts?.clientId ?? getClientId()
  const tokenUrl = opts?.tokenUrl ?? TOKEN_URL
  const redirectUri = opts?.redirectUri ?? REDIRECT_URI

  return {
    async exchangeCode(code, verifier) {
      const [rawCode, statePart] = code.split('#')
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: rawCode,
          state: statePart || verifier,
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Failed to exchange code: ${text}`)
      }
      return (await res.json()) as OAuthTokenResponse
    },

    async refreshToken(refresh) {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refresh,
          client_id: clientId,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Failed to refresh token: ${text}`)
      }
      return (await res.json()) as OAuthTokenResponse
    },
  }
}
