import type { Context, Hono } from 'hono'
import type { AnthropicClient } from '../../ports/anthropic-client'
import type { Logger } from '../../ports/logger'
import type {
  ErrorResponse,
  ModelInfo,
  ModelsListResponse,
} from '../../domain/proxy/types'

export interface ModelsDeps {
  anthropic: AnthropicClient
  logger: Logger
}

export function registerModelsRoutes(app: Hono, deps: ModelsDeps): void {
  app.get('/v1/models', async (c: Context) => {
    try {
      const modelsData = (await deps.anthropic.fetchModels()) as any
      const anthropicProvider = modelsData?.anthropic
      if (!anthropicProvider || !anthropicProvider.models) {
        return c.json<ModelsListResponse>({ object: 'list', data: [] })
      }

      const models: ModelInfo[] = Object.entries(
        anthropicProvider.models,
      ).map(([modelId, modelData]: [string, any]) => {
        const releaseDate = modelData.release_date || '1970-01-01'
        const created = Math.floor(new Date(releaseDate).getTime() / 1000)
        return { id: modelId, object: 'model', created, owned_by: 'anthropic' }
      })
      models.sort((a, b) => b.created - a.created)

      deps.logger.info('Available Anthropic models', {
        ids: models.map((m) => m.id),
      })
      return c.json<ModelsListResponse>({ object: 'list', data: models })
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
