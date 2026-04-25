import type { Context } from 'hono'

// Handle CORS preflight requests for all routes.
export const corsPreflightHandler = (c: Context) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
  )
  c.header('Access-Control-Allow-Headers', '*')
  c.header('Access-Control-Allow-Credentials', 'true')
  c.header('Access-Control-Max-Age', '86400')
  return c.body(null, 204)
}

// Middleware to add CORS headers to all responses.
export const corsMiddleware = async (
  c: Context,
  next: () => Promise<void>,
) => {
  await next()
  c.header('Access-Control-Allow-Origin', '*')
  c.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
  )
  c.header('Access-Control-Allow-Headers', '*')
  c.header('Access-Control-Allow-Credentials', 'true')
}
