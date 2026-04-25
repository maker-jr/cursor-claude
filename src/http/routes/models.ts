import type { Context, Hono } from 'hono'
import {
  extractAnthropicModels,
  toOpenAiList,
  type RawModelsDevResponse,
} from '../../domain/proxy/models'
import type { ErrorResponse, ModelsListResponse } from '../../domain/proxy/types'
import type { AnthropicClient } from '../../ports/anthropic-client'
import type { Logger } from '../../ports/logger'

export interface ModelsDeps {
  anthropic: AnthropicClient
  logger: Logger
}

export function registerModelsRoutes(app: Hono, deps: ModelsDeps): void {
  app.get('/v1/models', async (c: Context) => {
    try {
      const raw = (await deps.anthropic.fetchModels()) as RawModelsDevResponse
      const entries = extractAnthropicModels(raw)
      const list: ModelsListResponse = toOpenAiList(entries)
      deps.logger.info('Available Anthropic models', {
        ids: list.data.map((m) => m.id),
      })
      return c.json<ModelsListResponse>(list)
    } catch (err) {
      deps.logger.error('models route error', {
        message: (err as Error).message,
      })
      return c.json<ErrorResponse>(
        { error: 'Proxy error', details: (err as Error).message },
        500,
      )
    }
  })
}
