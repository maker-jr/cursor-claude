import { describe, expect, it } from 'vitest'
import {
  STATIC_FALLBACK_IDS,
  normalizeDotVersions,
  parseModelName,
  type ParsedModelName,
} from './model-name'

const IDS = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5',
  'claude-sonnet-latest',
]

function parse(input: string, ids = IDS): ParsedModelName | null {
  return parseModelName(input, ids)
}

describe('parseModelName — null cases', () => {
  it('returns null for an empty string', () => {
    expect(parse('')).toBeNull()
  })

  it('returns null for a non-Claude model id', () => {
    expect(parse('gpt-4o')).toBeNull()
    expect(parse('gemini-pro')).toBeNull()
  })

  it('returns null when the model looks close but has no catalog match', () => {
    expect(parse('claude-unknown-model')).toBeNull()
  })
})

describe('parseModelName — exact match (no suffix)', () => {
  it('returns the canonical id unchanged with no signals', () => {
    expect(parse('claude-sonnet-4-6')).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: null,
      unknownSuffix: [],
    })
  })

  it('handles -latest aliases', () => {
    expect(parse('claude-sonnet-latest')).toEqual({
      canonicalId: 'claude-sonnet-latest',
      thinking: false,
      effort: null,
      unknownSuffix: [],
    })
  })
})

describe('parseModelName — thinking suffix only', () => {
  it('sets thinking=true with no effort', () => {
    expect(parse('claude-sonnet-4-6-thinking')).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: true,
      effort: null,
      unknownSuffix: [],
    })
  })
})

describe('parseModelName — effort suffix only', () => {
  const cases: Array<[string, string]> = [
    ['low', 'claude-sonnet-4-6-low'],
    ['medium', 'claude-sonnet-4-6-medium'],
    ['high', 'claude-sonnet-4-6-high'],
    ['xhigh', 'claude-sonnet-4-6-xhigh'],
    ['max', 'claude-sonnet-4-6-max'],
  ]

  for (const [effort, input] of cases) {
    it(`parses effort=${effort}`, () => {
      expect(parse(input)).toEqual({
        canonicalId: 'claude-sonnet-4-6',
        thinking: false,
        effort,
        unknownSuffix: [],
      })
    })
  }
})

describe('parseModelName — thinking + effort', () => {
  it('parses thinking-xhigh', () => {
    expect(parse('claude-sonnet-4-6-thinking-xhigh')).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: true,
      effort: 'xhigh',
      unknownSuffix: [],
    })
  })

  it('parses thinking-max', () => {
    expect(parse('claude-opus-4-7-thinking-max')).toEqual({
      canonicalId: 'claude-opus-4-7',
      thinking: true,
      effort: 'max',
      unknownSuffix: [],
    })
  })

  it('parses thinking-low for 4.5 models', () => {
    expect(parse('claude-sonnet-4-5-thinking-low')).toEqual({
      canonicalId: 'claude-sonnet-4-5',
      thinking: true,
      effort: 'low',
      unknownSuffix: [],
    })
  })
})

describe('parseModelName — unknown suffixes', () => {
  it('accumulates unknown tokens', () => {
    expect(parse('claude-sonnet-4-6-plain')).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: null,
      unknownSuffix: ['plain'],
    })
  })

  it('accumulates multiple unknown tokens', () => {
    expect(parse('claude-sonnet-4-6-foo-bar')).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: null,
      unknownSuffix: ['foo', 'bar'],
    })
  })

  it('parses known tokens alongside unknown ones', () => {
    expect(parse('claude-sonnet-4-6-thinking-xhigh-custom')).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: true,
      effort: 'xhigh',
      unknownSuffix: ['custom'],
    })
  })
})

describe('parseModelName — longest-prefix match', () => {
  it('picks the longer id when a shorter one is also a prefix', () => {
    const ids = ['claude-sonnet-4', 'claude-sonnet-4-6']
    expect(parseModelName('claude-sonnet-4-6-thinking', ids)).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: true,
      effort: null,
      unknownSuffix: [],
    })
  })

    it("falls back to shorter id if longer id doesn't match", () => {
    const ids = ['claude-sonnet-4', 'claude-sonnet-4-6']
    expect(parseModelName('claude-sonnet-4-medium', ids)).toEqual({
      canonicalId: 'claude-sonnet-4',
      thinking: false,
      effort: 'medium',
      unknownSuffix: [],
    })
  })
})

describe('STATIC_FALLBACK_IDS', () => {
  it('contains at least the core 4.5 and 4.6 model ids', () => {
    expect(STATIC_FALLBACK_IDS).toContain('claude-sonnet-4-6')
    expect(STATIC_FALLBACK_IDS).toContain('claude-sonnet-4-5')
    expect(STATIC_FALLBACK_IDS).toContain('claude-opus-4-6')
    expect(STATIC_FALLBACK_IDS).toContain('claude-haiku-4-5')
  })

  it('can be used directly as knownModelIds', () => {
    const result = parseModelName(
      'claude-sonnet-4-6-thinking-xhigh',
      STATIC_FALLBACK_IDS,
    )
    expect(result?.canonicalId).toBe('claude-sonnet-4-6')
    expect(result?.thinking).toBe(true)
    expect(result?.effort).toBe('xhigh')
  })
})

describe('normalizeDotVersions', () => {
  it('converts a dot between digits to a hyphen', () => {
    expect(normalizeDotVersions('claude-sonnet-4.6')).toBe('claude-sonnet-4-6')
  })

  it('converts multiple digit-dot-digit occurrences', () => {
    expect(normalizeDotVersions('claude-opus-4.5.1')).toBe('claude-opus-4-5-1')
  })

  it('leaves dots that are not between two digits unchanged', () => {
    expect(normalizeDotVersions('claude-sonnet.latest')).toBe('claude-sonnet.latest')
    expect(normalizeDotVersions('claude.sonnet-4-6')).toBe('claude.sonnet-4-6')
  })

  it('is a no-op for strings with no dots', () => {
    expect(normalizeDotVersions('claude-sonnet-4-6-thinking')).toBe(
      'claude-sonnet-4-6-thinking',
    )
  })
})

describe('parseModelName — dot version separators', () => {
  it('parses claude-sonnet-4.6-medium (dot between version digits)', () => {
    expect(parse('claude-sonnet-4.6-medium')).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: 'medium',
      unknownSuffix: [],
    })
  })

  it('parses claude-sonnet-4.6-thinking-xhigh', () => {
    expect(parse('claude-sonnet-4.6-thinking-xhigh')).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: true,
      effort: 'xhigh',
      unknownSuffix: [],
    })
  })

  it('parses claude-opus-4.6-thinking', () => {
    expect(parse('claude-opus-4.6-thinking')).toEqual({
      canonicalId: 'claude-opus-4-6',
      thinking: true,
      effort: null,
      unknownSuffix: [],
    })
  })

  it('parses bare claude-sonnet-4.6 (no suffix)', () => {
    expect(parse('claude-sonnet-4.6')).toEqual({
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: null,
      unknownSuffix: [],
    })
  })

  it('parses claude-opus-4.7-thinking-max', () => {
    expect(parse('claude-opus-4.7-thinking-max')).toEqual({
      canonicalId: 'claude-opus-4-7',
      thinking: true,
      effort: 'max',
      unknownSuffix: [],
    })
  })
})
