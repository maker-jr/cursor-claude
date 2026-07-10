import {
  ANTHROPIC_BETA_HEADER,
  ANTHROPIC_VERSION,
  USER_AGENT,
} from '../../domain/proxy/policies'
import type {
  AnthropicClient,
  AnthropicFetchOptions,
  AnthropicFetchResponse,
} from '../../ports/anthropic-client'

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODELS_URL = 'https://models.dev/api.json'

// Deadline for the upstream to return response *headers*. Body streaming is
// not bounded by this — only the connect/first-response phase, which is where
// a dead connection would otherwise hang a chat forever.
const HEADERS_TIMEOUT_MS = 30_000
// models.dev is a nice-to-have catalog; never let it stall anything for long.
const MODELS_TIMEOUT_MS = 3_000

interface LinkedAbort {
  signal: AbortSignal
  // Call once response headers arrive: disarms the timeout while leaving the
  // caller-signal link intact so client disconnects still cancel the body.
  headersReceived: () => void
}

function withHeadersTimeout(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): LinkedAbort {
  const controller = new AbortController()
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason)
    } else {
      callerSignal.addEventListener(
        'abort',
        () => controller.abort(callerSignal.reason),
        { once: true },
      )
    }
  }
  const timer = setTimeout(() => {
    controller.abort(
      new Error(`upstream did not respond within ${timeoutMs}ms`),
    )
  }, timeoutMs)
  return {
    signal: controller.signal,
    headersReceived: () => clearTimeout(timer),
  }
}

// Test/dev seam: lets the CLI tests point the adapter at a local fixture
// server instead of hitting models.dev. Production users never set this.
function modelsUrl(): string {
  const override = process.env.CURSOR_CLAUDE_MODELS_URL
  return override && override.length > 0 ? override : DEFAULT_MODELS_URL
}

function collectHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

export function createHttpAnthropicClient(): AnthropicClient {
  return {
    async sendMessages(
      opts: AnthropicFetchOptions,
    ): Promise<AnthropicFetchResponse> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.accessToken}`,
        'anthropic-beta': ANTHROPIC_BETA_HEADER,
        'anthropic-version': ANTHROPIC_VERSION,
        'user-agent': USER_AGENT,
        accept: opts.streaming ? 'text/event-stream' : 'application/json',
        'accept-encoding': 'gzip, deflate',
      }

      const link = withHeadersTimeout(opts.signal, HEADERS_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(MESSAGES_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(opts.body),
          signal: link.signal,
        })
      } finally {
        link.headersReceived()
      }

      if (!res.ok) {
        const errorText = await res.text()
        return {
          ok: false,
          status: res.status,
          headers: collectHeaders(res),
          errorText,
          body: null,
        }
      }

      if (opts.streaming) {
        return {
          ok: true,
          status: res.status,
          headers: collectHeaders(res),
          body: res.body,
        }
      }

      const json = (await res.json()) as unknown
      return {
        ok: true,
        status: res.status,
        headers: collectHeaders(res),
        body: null,
        json,
      }
    },

    async fetchModels(): Promise<unknown> {
      const res = await fetch(modelsUrl(), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`models.dev request failed (${res.status}): ${text}`)
      }
      return await res.json()
    },
  }
}
