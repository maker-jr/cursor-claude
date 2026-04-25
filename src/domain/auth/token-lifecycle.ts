export interface OAuthCredentials {
  type: 'oauth'
  refresh: string
  access: string
  expires: number
}

export type TokenDecision =
  | { kind: 'missing' }
  | { kind: 'valid'; accessToken: string }
  | { kind: 'needs-refresh'; refreshToken: string }
  | { kind: 'expired-no-refresh' }

// Pure decision function: given stored credentials and the current time,
// decide whether to forward the token, refresh it, or ask the user to log in.
export function decideTokenAction(
  credentials: OAuthCredentials | null,
  now: number,
): TokenDecision {
  if (!credentials || credentials.type !== 'oauth') return { kind: 'missing' }
  if (credentials.expires && credentials.expires > now) {
    return { kind: 'valid', accessToken: credentials.access }
  }
  if (credentials.refresh) {
    return { kind: 'needs-refresh', refreshToken: credentials.refresh }
  }
  return { kind: 'expired-no-refresh' }
}
