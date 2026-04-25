// Pure helpers for shaping the response from models.dev into the various
// formats the rest of the system needs:
//   - the OpenAI-compatible /v1/models response (used by the HTTP route)
//   - a richer view used by the `cursor-claude models` CLI command
//
// Kept dependency-free so it can be unit-tested without any I/O.

import type { ModelInfo } from './types'

/** Subset of the models.dev payload we care about. */
export interface RawModelsDevResponse {
  anthropic?: {
    models?: Record<
      string,
      {
        name?: string
        release_date?: string
        [key: string]: unknown
      }
    >
  }
  [key: string]: unknown
}

/** Richer than `ModelInfo`: keeps the human-readable name + raw release date. */
export interface ModelEntry {
  id: string
  name: string
  releaseDate: string | null
  /** Unix timestamp (seconds), 0 if release date is missing/unparseable. */
  created: number
  ownedBy: 'anthropic'
}

/**
 * Extract Anthropic models from a models.dev payload, sorted newest first.
 * Returns an empty array when the payload is missing the anthropic provider
 * or its models map.
 */
export function extractAnthropicModels(
  raw: RawModelsDevResponse | null | undefined,
): ModelEntry[] {
  const models = raw?.anthropic?.models
  if (!models || typeof models !== 'object') return []

  const entries: ModelEntry[] = Object.entries(models).map(([id, m]) => {
    const rawDate =
      typeof m?.release_date === 'string' && m.release_date.length > 0
        ? m.release_date
        : null
    const created = parseReleaseTimestamp(rawDate)
    // Drop the date string if it didn't parse — keeps the contract clean
    // (consumers can render "—" without re-validating).
    const releaseDate = created > 0 ? rawDate : null
    return {
      id,
      name: typeof m?.name === 'string' && m.name.length > 0 ? m.name : id,
      releaseDate,
      created,
      ownedBy: 'anthropic',
    }
  })

  // Newest first; tiebreak by id so the order is stable across runs.
  entries.sort((a, b) => {
    if (b.created !== a.created) return b.created - a.created
    return a.id.localeCompare(b.id)
  })

  return entries
}

/**
 * Convert ModelEntry[] to the OpenAI `{ object: 'list', data: ModelInfo[] }`
 * shape served at /v1/models.
 */
export function toOpenAiList(entries: ModelEntry[]): {
  object: 'list'
  data: ModelInfo[]
} {
  return {
    object: 'list',
    data: entries.map((e) => ({
      id: e.id,
      object: 'model',
      created: e.created,
      owned_by: e.ownedBy,
    })),
  }
}

function parseReleaseTimestamp(releaseDate: string | null): number {
  if (!releaseDate) return 0
  const ms = Date.parse(releaseDate)
  if (Number.isNaN(ms)) return 0
  return Math.floor(ms / 1000)
}
