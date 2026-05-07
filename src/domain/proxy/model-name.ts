// Parses Cursor-emitted model name strings into a canonical Anthropic model id
// plus optional metadata tokens (thinking flag, effort level).
//
// Background: Cursor 4.6+ natively recognises `claude-*` ids and refuses to
// add them via "Override OpenAI Base URL". Users work around this by
// registering variant names such as:
//   claude-sonnet-4-6-thinking-xhigh   (canonical order, hyphen-separated)
//   claude-sonnet-4.6-medium            (dot version separator)
//   claude-4.6-sonnet-medium            (version before family name)
//   claude-4-6-sonnet-medium            (version before family name, no dots)
//
// Two normalisation steps run before catalog matching:
//   1. Dot-version normalisation  — "4.6" → "4-6"
//   2. Word-order normalisation   — "claude-4-6-sonnet" → "claude-sonnet-4-6"
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
 * Normalise dots used as version separators to hyphens.
 *
 * Cursor sometimes registers model names with dots (e.g. "claude-sonnet-4.6").
 * Anthropic's canonical ids use hyphens ("claude-sonnet-4-6"). We convert
 * dots that sit between two digit characters so that both forms match the
 * same catalog entry.
 *
 * "4.6" → "4-6"   "4.5.1" → "4-5-1"   "sonnet.4" → "sonnet.4" (unchanged —
 * dot is not between two digits so we leave it alone to avoid false-positives).
 */
export function normalizeDotVersions(input: string): string {
  // Use a lookahead for the trailing digit so consecutive dots in version
  // strings like "4.5.1" are all converted ("4.5.1" → "4-5-1").
  return input.replace(/(\d)\.(?=\d)/g, '$1-')
}

/**
 * Known Claude model family names (the word between "claude-" and the version).
 * Used to detect and fix inverted word-order like "claude-4-6-sonnet".
 */
const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'mythos'] as const

/**
 * Normalise inverted word-order in Cursor model names.
 *
 * Cursor sometimes emits "claude-<version>-<family>" instead of the canonical
 * "claude-<family>-<version>". After dot-version normalisation the version is
 * already all-digits-and-hyphens, so we can detect this shape with a regex and
 * swap the segments back into canonical order.
 *
 * "claude-4-6-sonnet"        → "claude-sonnet-4-6"
 * "claude-4-6-sonnet-medium" → "claude-sonnet-4-6-medium"  (suffix preserved)
 * "claude-sonnet-4-6"        → unchanged  (already canonical)
 */
export function normalizeWordOrder(input: string): string {
  // Match: claude - <major>-<minor>[…] - <known family> - <optional rest>
  // The version part must contain at least one hyphen (e.g. "4-6", "4-5-1")
  // so bare single-digit Claude 3 names like "claude-3-opus" are left alone.
  const familyPattern = MODEL_FAMILIES.join('|')
  const re = new RegExp(
    `^(claude)-(\\d+(?:-\\d+)+)-(${familyPattern})((?:-.+)?)$`,
  )
  const m = re.exec(input)
  if (!m) return input
  const [, prefix, version, family, rest] = m
  return `${prefix}-${family}-${version}${rest}`
}

/**
 * Parse a (potentially Cursor-suffixed) model name string.
 *
 * Two normalisation steps run before catalog matching:
 *   1. Dot-version separators are converted to hyphens ("4.6" → "4-6").
 *   2. Inverted word order is corrected ("claude-4-6-sonnet" → "claude-sonnet-4-6").
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
  const normalised = normalizeWordOrder(normalizeDotVersions(input))
  const sorted = [...knownModelIds].sort((a, b) => b.length - a.length)

  let canonicalId: string | null = null
  let remainder = ''

  for (const id of sorted) {
    if (normalised === id) {
      canonicalId = id
      remainder = ''
      break
    }
    if (normalised.startsWith(id + '-')) {
      canonicalId = id
      remainder = normalised.slice(id.length + 1)
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
