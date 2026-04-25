import type { Context } from 'hono'

export interface RequireApiKeyOptions {
  // Static key to compare against (from env or persisted config).
  expected: string | undefined
}

// Returns a 401 Response when the authorization header is provided but does
// not match the expected key. A missing header is allowed (current behavior).
export function checkApiKey(
  c: Context,
  expected: string | undefined,
): Response | null {
  const authHeader = c.req.header('authorization')
  const apiKey = authHeader?.split(' ')?.[1]
  if (apiKey && expected && apiKey !== expected) {
    return c.json(
      {
        error: 'Authentication required',
        message: 'Please authenticate using the configured API key.',
      },
      401,
    )
  }
  return null
}
