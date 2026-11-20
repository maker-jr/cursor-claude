// Fast mode: Anthropic's `speed: "fast"` request parameter runs the same model
// at up to ~2.5x output tokens/sec (premium pricing).
//
// Clients signal it three ways, all normalised here:
//   - Cursor's "Fast" toggle on an OpenAI-compatible endpoint sends OpenAI's
//     `service_tier: "priority"` (or the newer alias `"fast"`).
//   - A `fast` token in the model name, e.g. "claude-opus-5-5-thinking-fast".
//   - Native Anthropic callers send `speed: "fast"` directly.
//
// Only some models support it; on any other model `speed: "fast"` is a 400, so
// the request is downgraded to standard speed instead of failing.

import type { AnthropicRequestBody } from './types'

export const FAST_MODE_BETA = 'fast-mode-2026-02-01'

// GA fast mode: no beta header needed.
const FAST_GA_MODELS = ['claude-opus-5-5', 'claude-fable-5-2', 'claude-mythos-5-2']
// Research preview / deprecated: fast mode needs the beta header.
const FAST_BETA_MODELS = ['claude-opus-5', 'claude-opus-4-8']

const FAST_SERVICE_TIERS = new Set(['priority', 'fast'])

export type FastModeSupport = 'ga' | 'beta' | null

// Exact id or a dated snapshot of it ("claude-opus-5-20260101"). Plain
// startsWith would wrongly treat "claude-opus-5-5" as "claude-opus-5".
function matchesId(model: string, id: string): boolean {
  return model === id || new RegExp(`^${id}-\\d{8}$`).test(model)
}

export function fastModeSupport(model: string): FastModeSupport {
  if (FAST_GA_MODELS.some((id) => matchesId(model, id))) return 'ga'
  if (FAST_BETA_MODELS.some((id) => matchesId(model, id))) return 'beta'
  return null
}

/** True when the client asked for fast mode via any supported signal. */
export function requestsFastMode(body: AnthropicRequestBody): boolean {
  if (body.speed === 'fast') return true
  const tier = body.service_tier
  return typeof tier === 'string' && FAST_SERVICE_TIERS.has(tier.toLowerCase())
}

export interface FastModeResult {
  /** Whether `speed: "fast"` will be sent upstream. */
  fast: boolean
  /** Requested but the model doesn't support it — downgraded to standard. */
  downgraded: boolean
  /** Extra anthropic-beta values required for this request. */
  betas: string[]
}

/**
 * Mutates `body`: sets `speed: "fast"` when requested and supported by
 * `body.model`, otherwise removes `speed`. Must run before OpenAI-only keys
 * (including `service_tier`) are stripped, and after the model id has been
 * canonicalised.
 */
export function applyFastMode(body: AnthropicRequestBody): FastModeResult {
  const wanted = requestsFastMode(body)
  const support = fastModeSupport(body.model)

  if (wanted && support !== null) {
    body.speed = 'fast'
    return {
      fast: true,
      downgraded: false,
      betas: support === 'beta' ? [FAST_MODE_BETA] : [],
    }
  }

  delete body.speed
  return { fast: false, downgraded: wanted, betas: [] }
}
