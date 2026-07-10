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
import type {
  AnthropicClient,
  AnthropicFetchOptions,
  AnthropicFetchResponse,
} from '../../ports/anthropic-client'
import type { Clock } from '../../ports/clock'
import type {
  CredentialStore,
  OAuthCredentials,
} from '../../ports/credential-store'
import type { Logger } from '../../ports/logger'
import type { OAuthClient } from '../../ports/oauth-client'
import { checkApiKey } from '../middleware/require-api-key'

// ---------------------------------------------------------------------------
// Model-name normalisation cache
// ---------------------------------------------------------------------------

const MODEL_ID_CACHE_TTL_MS = 5 * 60 * 1_000
// After a failed refresh, wait this long before trying models.dev again so an
// outage there never adds per-request latency here.
const MODEL_ID_NEGATIVE_TTL_MS = 60 * 1_000

let _cachedModelIds: readonly string[] | null = null
let _cacheExpiresAt = 0
let _refreshInFlight: Promise<readonly string[]> | null = null

/** Reset the model-id cache. Exported for use in tests only. */
export function resetModelIdCache(): void {
  _cachedModelIds = null
  _cacheExpiresAt = 0
  _refreshInFlight = null
}

async function refreshModelIds(
  anthropic: AnthropicClient,
): Promise<readonly string[]> {
  try {
    const raw = await anthropic.fetchModels()
    const entries = extractAnthropicModels(
      raw as Parameters<typeof extractAnthropicModels>[0],
    )
    if (entries.length > 0) {
      _cachedModelIds = entries.map((e) => e.id)
      _cacheExpiresAt = Date.now() + MODEL_ID_CACHE_TTL_MS
      return _cachedModelIds
    }
  } catch {
    // fall through to the negative-cache path
  }
  _cachedModelIds = _cachedModelIds ?? STATIC_FALLBACK_IDS
  _cacheExpiresAt = Date.now() + MODEL_ID_NEGATIVE_TTL_MS
  return _cachedModelIds
}

// Chat requests must never wait on models.dev. Only the very first request
// after startup blocks (bounded by the client's own short timeout); once any
// list is cached — live, stale, or static fallback — it is served immediately
// and refreshed in the background, single-flight.
async function fetchCachedModelIds(
  anthropic: AnthropicClient,
): Promise<readonly string[]> {
  if (_cachedModelIds !== null && Date.now() < _cacheExpiresAt) {
    return _cachedModelIds
  }
  if (_refreshInFlight === null) {
    _refreshInFlight = refreshModelIds(anthropic).finally(() => {
      _refreshInFlight = null
    })
  }
  if (_cachedModelIds !== null) return _cachedModelIds
  return _refreshInFlight
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

// ---------------------------------------------------------------------------
// Upstream retry / timeouts
// ---------------------------------------------------------------------------

// Only retried before any bytes have been forwarded to the client, so a retry
// is invisible to it. 529 is Anthropic's "overloaded" status.
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529])
const RETRY_DELAYS_MS = [300, 1200]

// Anthropic sends SSE pings every few seconds; a stream this quiet is dead.
const STREAM_IDLE_TIMEOUT_MS = 90_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendMessagesWithRetry(
  deps: MessagesDeps,
  opts: AnthropicFetchOptions,
): Promise<AnthropicFetchResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await deps.anthropic.sendMessages(opts)
      if (
        res.ok ||
        attempt >= RETRY_DELAYS_MS.length ||
        !RETRYABLE_STATUSES.has(res.status)
      ) {
        return res
      }
      deps.logger.warn('retryable upstream status, retrying', {
        status: res.status,
        attempt: attempt + 1,
      })
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || opts.signal?.aborted) throw err
      deps.logger.warn('upstream request failed, retrying', {
        message: (err as Error).message,
        attempt: attempt + 1,
      })
    }
    await sleep(RETRY_DELAYS_MS[attempt])
  }
}

function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof reader.read>>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`upstream stream idle for ${timeoutMs}ms`)),
        timeoutMs,
      )
    }),
  ]).finally(() => clearTimeout(timer))
}

// ---------------------------------------------------------------------------
// Response header pass-through
// ---------------------------------------------------------------------------

// Body-framing and hop-by-hop headers must not be copied from the upstream
// response: the proxy re-frames the body (and changes its size when
// transforming), so a stale content-length makes clients wait forever for
// bytes that never arrive.
const SKIP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
])

function copyUpstreamHeaders(
  c: Context,
  headers: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(headers)) {
    if (SKIP_RESPONSE_HEADERS.has(key)) continue
    c.header(key, value)
  }
}

// ---------------------------------------------------------------------------
// OAuth token cache
// ---------------------------------------------------------------------------

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

// Refresh this long before hard expiry, so in-flight requests never race the
// expiry edge and a refresh happens exactly once instead of per-request.
const TOKEN_EXPIRY_BUFFER_MS = 30_000

interface TokenCache {
  // In-memory copy of the store record; skips the credential-store round-trip
  // (an HTTPS call on Upstash, a disk read locally) on every request.
  creds: OAuthCredentials | null
  // Single-flight refresh: concurrent requests share one refreshToken call.
  // Anthropic rotates refresh tokens, so parallel refreshes would invalidate
  // each other's credentials and force a manual re-login.
  refreshing: Promise<string | null> | null
}

async function doRefresh(
  deps: MessagesDeps,
  cache: TokenCache,
  refreshToken: string,
): Promise<string | null> {
  try {
    const tokens = await deps.oauth.refreshToken(refreshToken)
    const creds: OAuthCredentials = {
      type: 'oauth',
      refresh: tokens.refresh_token,
      access: tokens.access_token,
      expires: deps.clock.now() + tokens.expires_in * 1000,
    }
    cache.creds = creds
    await deps.credentialStore.set(AUTH_KEY, creds)
    return tokens.access_token
  } catch (err) {
    deps.logger.error('OAuth refresh failed', {
      message: (err as Error).message,
    })
    cache.creds = null
    return null
  }
}

async function resolveAccessToken(
  deps: MessagesDeps,
  cache: TokenCache,
): Promise<string | null> {
  const effectiveNow = deps.clock.now() + TOKEN_EXPIRY_BUFFER_MS

  if (cache.creds) {
    const cached = decideTokenAction(cache.creds, effectiveNow)
    if (cached.kind === 'valid') return cached.accessToken
  }
  if (cache.refreshing) return cache.refreshing

  const credentials = await deps.credentialStore.get(AUTH_KEY)
  const decision = decideTokenAction(credentials, effectiveNow)
  switch (decision.kind) {
    case 'valid':
      cache.creds = credentials
      return decision.accessToken
    case 'needs-refresh': {
      // Another request may have started a refresh while we awaited the store.
      if (!cache.refreshing) {
        cache.refreshing = doRefresh(deps, cache, decision.refreshToken).finally(
          () => {
            cache.refreshing = null
          },
        )
      }
      return cache.refreshing
    }
    case 'expired-no-refresh':
    case 'missing':
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function registerMessagesRoutes(app: Hono, deps: MessagesDeps): void {
  const tokenCache: TokenCache = { creds: null, refreshing: null }

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
      // Independent lookups; run them concurrently.
      const [, oauthToken] = await Promise.all([
        normalizeModelInBody(body, deps.anthropic, deps.logger),
        resolveAccessToken(deps, tokenCache),
      ])
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

      const { transformToOpenAIFormat } = transformRequest(body)

      const upstream = await sendMessagesWithRetry(deps, {
        body,
        accessToken: oauthToken,
        streaming: isStreaming,
        // Propagate client disconnects so cancelled requests die upstream too.
        signal: c.req.raw.signal,
      })

      if (!upstream.ok) {
        deps.logger.error('upstream error', {
          status: upstream.status,
          text: upstream.errorText,
        })
        if (upstream.status === 401) {
          // The stored/cached token is bad; force a store re-read next time.
          tokenCache.creds = null
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
        copyUpstreamHeaders(c, upstream.headers)

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
          writer.onAbort(() => {
            reader.cancel().catch(() => {})
          })
          try {
            while (true) {
              const { done, value } = await readWithIdleTimeout(
                reader,
                STREAM_IDLE_TIMEOUT_MS,
              )
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
            // Surface the failure to the client instead of silently closing
            // the connection — IDEs render a silent close as an endless
            // spinner.
            const message = `Proxy stream error: ${(err as Error).message}`
            try {
              if (transformToOpenAIFormat) {
                await writer.write(
                  `data: ${JSON.stringify({
                    error: { message, type: 'proxy_stream_error' },
                  })}\n\n`,
                )
                await writer.write('data: [DONE]\n\n')
              } else {
                await writer.write(
                  `event: error\ndata: ${JSON.stringify({
                    type: 'error',
                    error: { type: 'proxy_stream_error', message },
                  })}\n\n`,
                )
              }
            } catch {
              // client already gone
            }
          } finally {
            // cancel() (not just releaseLock) so the upstream request is torn
            // down and stops consuming rate limit.
            reader.cancel().catch(() => {})
          }
        })
      }

      // Non-streaming branch.
      const responseData = upstream.json as AnthropicResponse
      copyUpstreamHeaders(c, upstream.headers)

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
