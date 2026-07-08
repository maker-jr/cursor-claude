import type { Context, Hono } from 'hono'
import { stream } from 'hono/streaming'
import {
  createCursorBypassResponse,
  isCursorKeyCheck,
} from '../../domain/proxy/cursor-bypass'
import { applyThinkingAndEffort } from '../../domain/proxy/extended-thinking'
import { STATIC_FALLBACK_IDS, parseModelName } from '../../domain/proxy/model-name'
import { extractAnthropicModels } from '../../domain/proxy/models'
import {
  createConverterState,
  flushPendingLine,
  processChunk,
} from '../../domain/proxy/stream-converter'
import { convertNonStreamingResponse } from '../../domain/proxy/transform-response'
import { transformRequest } from '../../domain/proxy/transform-request'
import type {
  AnthropicRequestBody,
  AnthropicResponse,
  ErrorResponse,
} from '../../domain/proxy/types'
import { decideTokenAction } from '../../domain/auth/token-lifecycle'
import type { AnthropicClient } from '../../ports/anthropic-client'
import type { Clock } from '../../ports/clock'
import type { CredentialStore } from '../../ports/credential-store'
import type { Logger } from '../../ports/logger'
import type { OAuthClient } from '../../ports/oauth-client'
import { checkApiKey } from '../middleware/require-api-key'

// ---------------------------------------------------------------------------
// Model-name normalisation cache
// ---------------------------------------------------------------------------

const MODEL_ID_CACHE_TTL_MS = 5 * 60 * 1_000

let _cachedModelIds: readonly string[] | null = null
let _cacheExpiresAt = 0

/** Reset the model-id cache. Exported for use in tests only. */
export function resetModelIdCache(): void {
  _cachedModelIds = null
  _cacheExpiresAt = 0
}

async function fetchCachedModelIds(
  anthropic: AnthropicClient,
): Promise<readonly string[]> {
  const now = Date.now()
  if (_cachedModelIds !== null && now < _cacheExpiresAt) {
    return _cachedModelIds
  }
  try {
    const raw = await anthropic.fetchModels()
    const entries = extractAnthropicModels(
      raw as Parameters<typeof extractAnthropicModels>[0],
    )
    if (entries.length > 0) {
      _cachedModelIds = entries.map((e) => e.id)
      _cacheExpiresAt = now + MODEL_ID_CACHE_TTL_MS
      return _cachedModelIds
    }
  } catch {
    // fall through to static fallback
  }
  return STATIC_FALLBACK_IDS
}

/**
 * Normalise `body.model` in-place: strip Cursor-appended suffixes and inject
 * the corresponding Anthropic API params (`thinking`, `output_config.effort`).
 * Warn-logs unrecognised suffix tokens so operators can spot them.
 */
async function normalizeModelInBody(
  body: AnthropicRequestBody,
  anthropic: AnthropicClient,
  logger: Logger,
): Promise<void> {
  const knownIds = await fetchCachedModelIds(anthropic)
  const originalModel = body.model
  const parsed = parseModelName(body.model, knownIds)
  if (parsed === null) return

  body.model = parsed.canonicalId

  applyThinkingAndEffort(body, parsed)

  if (parsed.unknownSuffix.length > 0) {
    logger.warn('unrecognized model suffix tokens stripped', {
      original: originalModel,
      unknownSuffix: parsed.unknownSuffix,
      canonicalId: parsed.canonicalId,
    })
  }
}

export interface MessagesDeps {
  anthropic: AnthropicClient
  credentialStore: CredentialStore
  oauth: OAuthClient
  clock: Clock
  logger: Logger
  // How to compute the expected API key for each request. A function (not a
  // static value) so `start` can swap the key at runtime.
  getExpectedApiKey: () => string | undefined
}

// The credential key used in the store for the Anthropic OAuth record.
const AUTH_KEY = 'auth:anthropic'

async function resolveAccessToken(
  deps: MessagesDeps,
): Promise<string | null> {
  const credentials = await deps.credentialStore.get(AUTH_KEY)
  const decision = decideTokenAction(credentials, deps.clock.now())
  switch (decision.kind) {
    case 'valid':
      return decision.accessToken
    case 'needs-refresh': {
      try {
        const tokens = await deps.oauth.refreshToken(decision.refreshToken)
        const expires = deps.clock.now() + tokens.expires_in * 1000
        await deps.credentialStore.set(AUTH_KEY, {
          type: 'oauth',
          refresh: tokens.refresh_token,
          access: tokens.access_token,
          expires,
        })
        return tokens.access_token
      } catch (err) {
        deps.logger.error('OAuth refresh failed', {
          message: (err as Error).message,
        })
        return null
      }
    }
    case 'expired-no-refresh':
    case 'missing':
    default:
      return null
  }
}

export function registerMessagesRoutes(app: Hono, deps: MessagesDeps): void {
  const handler = async (c: Context) => {
    const body = (await c.req.json()) as AnthropicRequestBody
    const isStreaming = body.stream === true

    deps.logger.info('proxy request', {
      method: c.req.method,
      path: c.req.path,
      model: body.model,
      streaming: isStreaming,
    })

    const apiKeyErr = checkApiKey(c, deps.getExpectedApiKey())
    if (apiKeyErr) return apiKeyErr

    if (isCursorKeyCheck(body)) {
      return c.json(createCursorBypassResponse())
    }

    try {
      await normalizeModelInBody(body, deps.anthropic, deps.logger)

      const { transformToOpenAIFormat } = transformRequest(body)

      const oauthToken = await resolveAccessToken(deps)
      if (!oauthToken) {
        return c.json<ErrorResponse>(
          {
            error: 'Authentication required',
            message:
              'Please authenticate using OAuth first. Run cursor-claude login.',
          },
          401,
        )
      }

      const upstream = await deps.anthropic.sendMessages({
        body,
        accessToken: oauthToken,
        streaming: isStreaming,
      })

      if (!upstream.ok) {
        deps.logger.error('upstream error', {
          status: upstream.status,
          text: upstream.errorText,
        })
        if (upstream.status === 401) {
          return c.json<ErrorResponse>(
            {
              error: 'Authentication failed',
              message:
                'OAuth token may be expired. Please re-authenticate (cursor-claude login).',
              details: upstream.errorText,
            },
            401,
          )
        }
        return new Response(upstream.errorText ?? '', {
          status: upstream.status,
          headers: { 'Content-Type': 'text/plain' },
        })
      }

      if (isStreaming) {
        for (const [key, value] of Object.entries(upstream.headers)) {
          if (
            key === 'content-encoding' ||
            key === 'content-length' ||
            key === 'transfer-encoding'
          ) {
            continue
          }
          c.header(key, value)
        }

        const upstreamBody = upstream.body
        if (!upstreamBody) {
          return c.json<ErrorResponse>(
            { error: 'Proxy error', details: 'Missing upstream body' },
            500,
          )
        }

        const reader = upstreamBody.getReader()
        const decoder = new TextDecoder()

        return stream(c, async (writer) => {
          const converterState = createConverterState()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const chunk = decoder.decode(value, { stream: true })

              if (transformToOpenAIFormat) {
                const results = processChunk(converterState, chunk)
                for (const result of results) {
                  if (result.type === 'chunk' && result.data) {
                    await writer.write(
                      `data: ${JSON.stringify(result.data)}\n\n`,
                    )
                  } else if (result.type === 'done') {
                    await writer.write('data: [DONE]\n\n')
                  }
                }
              } else {
                await writer.write(chunk)
              }
            }

            // The upstream may end without a trailing newline after the last
            // SSE line; flush whatever line-fragment is still buffered so it
            // isn't silently lost.
            if (transformToOpenAIFormat) {
              const finalResults = flushPendingLine(converterState)
              for (const result of finalResults) {
                if (result.type === 'chunk' && result.data) {
                  await writer.write(`data: ${JSON.stringify(result.data)}\n\n`)
                } else if (result.type === 'done') {
                  await writer.write('data: [DONE]\n\n')
                }
              }
            }
          } catch (err) {
            deps.logger.error('stream error', {
              message: (err as Error).message,
            })
          } finally {
            reader.releaseLock()
          }
        })
      }

      // Non-streaming branch.
      const responseData = upstream.json as AnthropicResponse
      for (const [key, value] of Object.entries(upstream.headers)) {
        if (key === 'content-encoding') continue
        c.header(key, value)
      }

      if (transformToOpenAIFormat) {
        return c.json(convertNonStreamingResponse(responseData))
      }
      return c.json(responseData)
    } catch (err) {
      deps.logger.error('proxy error', { message: (err as Error).message })
      return c.json<ErrorResponse>(
        { error: 'Proxy error', details: (err as Error).message },
        500,
      )
    }
  }

  app.post('/v1/chat/completions', handler)
  app.post('/v1/messages', handler)
}
