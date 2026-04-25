import crypto from 'node:crypto'
import { OAUTH_SCOPES } from '../proxy/policies'

export interface PKCE {
  verifier: string
  challenge: string
}

export function generatePKCE(): PKCE {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url')
  return { verifier, challenge }
}

export interface AuthUrlParams {
  clientId: string
  redirectUri: string
  pkce: PKCE
}

export function getAuthorizationUrl({
  clientId,
  redirectUri,
  pkce,
}: AuthUrlParams): string {
  const authUrl = new URL('https://claude.ai/oauth/authorize')
  authUrl.searchParams.set('code', 'true')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', OAUTH_SCOPES)
  authUrl.searchParams.set('code_challenge', pkce.challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', pkce.verifier)
  return authUrl.toString()
}
