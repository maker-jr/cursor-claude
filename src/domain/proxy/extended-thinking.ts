// Applies thinking and effort metadata (parsed from Cursor-style model name
// suffixes) to an Anthropic request body.
//
// Model-generation matrix:
//   - 4.6 / 4.7 family  → thinking: { type: 'adaptive' }
//   - 4.5 / older       → thinking: { type: 'enabled', budget_tokens: N }
//
// "effort" always maps to output_config.effort regardless of model generation.

import type { EffortLevel, ParsedModelName } from './model-name'
import type { AnthropicRequestBody } from './types'

/**
 * Whether a canonical model id belongs to the 4.6/4.7 generation that
 * supports `thinking: { type: 'adaptive' }`.
 */
export function isAdaptiveThinkingModel(canonicalId: string): boolean {
  return (
    canonicalId.includes('opus-4-6') ||
    canonicalId.includes('sonnet-4-6') ||
    canonicalId.includes('opus-4-7') ||
    canonicalId.includes('mythos')
  )
}

/**
 * Maps an effort level to a budget_tokens cap for models that only support
 * `thinking: { type: 'enabled', budget_tokens }` (4.5 and older).
 */
const EFFORT_TO_BUDGET: Record<EffortLevel, number> = {
  low: 4_000,
  medium: 8_000,
  high: 16_000,
  xhigh: 32_000,
  max: 64_000,
}

/** Default budget_tokens when thinking is requested but no effort was given. */
const DEFAULT_BUDGET_TOKENS = 16_000

/**
 * Mutates `body` in-place, applying thinking and effort parameters derived
 * from the parsed model-name metadata.
 *
 * - Sets `body.thinking` if `parsed.thinking` is true (adaptive for 4.6/4.7,
 *   enabled+budget for older models). A pre-existing `body.thinking` is
 *   overwritten only if parsed.thinking is true.
 * - Sets / merges `body.output_config.effort` if `parsed.effort` is non-null.
 *   Pre-existing `output_config` keys are preserved.
 * - Does nothing if both flags are absent.
 */
export function applyThinkingAndEffort(
  body: AnthropicRequestBody,
  parsed: Pick<ParsedModelName, 'thinking' | 'effort' | 'canonicalId'>,
): void {
  if (parsed.thinking) {
    if (isAdaptiveThinkingModel(parsed.canonicalId)) {
      body.thinking = { type: 'adaptive' }
    } else {
      const budgetTokens =
        parsed.effort != null
          ? EFFORT_TO_BUDGET[parsed.effort]
          : DEFAULT_BUDGET_TOKENS
      body.thinking = { type: 'enabled', budget_tokens: budgetTokens }
    }
  }

  if (parsed.effort != null) {
    const existing =
      body.output_config != null &&
      typeof body.output_config === 'object' &&
      !Array.isArray(body.output_config)
        ? (body.output_config as Record<string, unknown>)
        : {}
    body.output_config = { ...existing, effort: parsed.effort }
  }
}
