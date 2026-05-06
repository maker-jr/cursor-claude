// Parses Cursor-emitted model name strings into a canonical Anthropic model id
// plus optional metadata tokens (thinking flag, effort level).
//
// Background: Cursor 4.6+ natively recognises `claude-*` ids and refuses to
// add them via "Override OpenAI Base URL". Users work around this by
// registering variant names such as:
//   claude-sonnet-4-6-thinking-xhigh
//   claude-sonnet-4-6-medium
//   claude-opus-4-6-thinking
//
// This module strips those suffixes, identifies the canonical id, and surfaces
// the parsed metadata so callers can inject the correct Anthropic API params.

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ParsedModelName {
  /** The canonical Anthropic model id (e.g. "claude-sonnet-4-6"). */
  canonicalId: string
  /** True when the "thinking" token was present in the suffix. */
  thinking: boolean
  /** Effort level token, if present. */
  effort: EffortLevel | null
  /** Any remaining tokens that weren't recognized. */
  unknownSuffix: string[]
}

const EFFORT_LEVELS = new Set<string>(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * Static fallback list of canonical Claude model ids used when the live
 * models.dev fetch hasn't completed yet or fails. Keep this list current with
 * the models you want the proxy to handle out-of-the-box; the live catalog
 * supersedes it when available.
 */
export const STATIC_FALLBACK_IDS: readonly string[] = [
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-6-20251101',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-6-20251101',
  'claude-sonnet-4-5-20251101',
  'claude-haiku-4-6-20251101',
  'claude-haiku-4-5-20251101',
  'claude-opus-4-7',
  'claude-opus-latest',
  'claude-sonnet-latest',
  'claude-haiku-latest',
]

/**
 * Parse a (potentially Cursor-suffixed) model name string.
 *
 * Uses longest-prefix match against `knownModelIds` to identify the canonical
 * id. The remainder is tokenised on "-" and each token classified:
 *   - "thinking"         → sets thinking = true
 *   - effort level token → sets effort
 *   - anything else      → accumulated in unknownSuffix
 *
 * Returns `null` only when no canonical id matches (e.g. a non-Claude model).
 * In all other cases returns a ParsedModelName even when only unknown suffixes
 * were found.
 */
export function parseModelName(
  input: string,
  knownModelIds: readonly string[],
): ParsedModelName | null {
  const sorted = [...knownModelIds].sort((a, b) => b.length - a.length)

  let canonicalId: string | null = null
  let remainder = ''

  for (const id of sorted) {
    if (input === id) {
      canonicalId = id
      remainder = ''
      break
    }
    if (input.startsWith(id + '-')) {
      canonicalId = id
      remainder = input.slice(id.length + 1)
      break
    }
  }

  if (canonicalId === null) return null

  const tokens = remainder.length > 0 ? remainder.split('-') : []
  let thinking = false
  let effort: EffortLevel | null = null
  const unknownSuffix: string[] = []

  for (const token of tokens) {
    if (token === 'thinking') {
      thinking = true
    } else if (EFFORT_LEVELS.has(token)) {
      effort = token as EffortLevel
    } else {
      unknownSuffix.push(token)
    }
  }

  return { canonicalId, thinking, effort, unknownSuffix }
}
