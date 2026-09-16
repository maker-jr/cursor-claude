// Applies thinking and effort metadata (parsed from Cursor-style model name
// suffixes) to an Anthropic request body.
//
// Model-generation matrix:
//   - 4.5 / older             → thinking: { type: 'enabled', budget_tokens: N },
//                               and no output_config.effort (rejected there)
//   - everything newer/unknown → thinking: { type: 'adaptive' }
//
// budget_tokens was REMOVED on 4.7+ and the whole Claude 5 family — sending it
// there returns a 400 — so adaptive must be the default for any id we don't
// positively recognize as legacy. That also future-proofs brand-new models.

import type { EffortLevel, ParsedModelName } from './model-name'
import type { AnthropicRequestBody } from './types'

/**
 * Whether a canonical model id belongs to the 4.5-and-older generation that
 * still requires `thinking: { type: 'enabled', budget_tokens }` and rejects
 * `output_config.effort`.
 */
export function usesBudgetThinking(canonicalId: string): boolean {
  return (
    canonicalId.includes('claude-3') ||
    canonicalId.includes('-4-0') ||
    canonicalId.includes('-4-1') ||
    canonicalId.includes('-4-5')
  )
}

/**
 * Whether a canonical model id supports `thinking: { type: 'adaptive' }`.
 * The complement of the legacy budget set, so unknown/future ids default to
 * adaptive — the only mode current models accept.
 */
export function isAdaptiveThinkingModel(canonicalId: string): boolean {
  return !usesBudgetThinking(canonicalId)
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
 * - Sets `body.thinking` if `parsed.thinking` is true (enabled+budget for the
 *   4.5-and-older generation, adaptive for everything else). A pre-existing
 *   `body.thinking` is overwritten only if parsed.thinking is true.
 * - Sets / merges `body.output_config.effort` if `parsed.effort` is non-null
 *   and the model accepts it (not the legacy budget generation).
 *   Pre-existing `output_config` keys are preserved.
 * - Does nothing if both flags are absent.
 */
export function applyThinkingAndEffort(
  body: AnthropicRequestBody,
  parsed: Pick<ParsedModelName, 'thinking' | 'effort' | 'canonicalId'>,
): void {
  const legacyBudget = usesBudgetThinking(parsed.canonicalId)

  if (parsed.thinking) {
    if (legacyBudget) {
      const budgetTokens =
        parsed.effort != null
          ? EFFORT_TO_BUDGET[parsed.effort]
          : DEFAULT_BUDGET_TOKENS
      body.thinking = { type: 'enabled', budget_tokens: budgetTokens }
    } else {
      body.thinking = { type: 'adaptive' }
    }
  }

  // output_config.effort is rejected on the legacy budget generation; there
  // the effort signal has already been folded into budget_tokens above.
  if (parsed.effort != null && !legacyBudget) {
    const existing =
      body.output_config != null &&
      typeof body.output_config === 'object' &&
      !Array.isArray(body.output_config)
        ? (body.output_config as Record<string, unknown>)
        : {}
    body.output_config = { ...existing, effort: parsed.effort }
  }
}
