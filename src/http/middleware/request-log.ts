import type { Context } from 'hono'
import type { Logger } from '../../ports/logger'

export function requestLogMiddleware(logger: Logger) {
  return async (c: Context, next: () => Promise<void>) => {
    logger.info(`→ ${c.req.method} ${c.req.path}`)
    await next()
  }
}
