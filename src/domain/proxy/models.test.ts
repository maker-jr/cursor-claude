import { describe, expect, it } from 'vitest'
import {
  extractAnthropicModels,
  toOpenAiList,
  type RawModelsDevResponse,
} from './models'

describe('extractAnthropicModels', () => {
  it('returns [] when payload is null/undefined', () => {
    expect(extractAnthropicModels(null)).toEqual([])
    expect(extractAnthropicModels(undefined)).toEqual([])
  })

  it('returns [] when the anthropic provider is missing', () => {
    expect(extractAnthropicModels({})).toEqual([])
    expect(
      extractAnthropicModels({ openai: { models: { foo: {} } } } as unknown as RawModelsDevResponse),
    ).toEqual([])
  })

  it('returns [] when the anthropic.models map is missing or empty', () => {
    expect(extractAnthropicModels({ anthropic: {} })).toEqual([])
    expect(extractAnthropicModels({ anthropic: { models: {} } })).toEqual([])
  })

  it('extracts each model with id, name, releaseDate, created, ownedBy', () => {
    const raw: RawModelsDevResponse = {
      anthropic: {
        models: {
          'claude-sonnet-4-5-20250929': {
            name: 'Claude Sonnet 4.5',
            release_date: '2025-09-29',
          },
        },
      },
    }
    const out = extractAnthropicModels(raw)
    expect(out).toEqual([
      {
        id: 'claude-sonnet-4-5-20250929',
        name: 'Claude Sonnet 4.5',
        releaseDate: '2025-09-29',
        created: Math.floor(Date.parse('2025-09-29') / 1000),
        ownedBy: 'anthropic',
      },
    ])
  })

  it('falls back to id when name is missing', () => {
    const out = extractAnthropicModels({
      anthropic: { models: { 'claude-x': { release_date: '2024-01-01' } } },
    })
    expect(out[0]).toMatchObject({ id: 'claude-x', name: 'claude-x' })
  })

  it('handles missing or unparseable release_date by setting created=0 and releaseDate=null', () => {
    const out = extractAnthropicModels({
      anthropic: {
        models: {
          'no-date': { name: 'No Date' },
          'bad-date': { name: 'Bad', release_date: 'not-a-date' },
        },
      },
    })
    const noDate = out.find((m) => m.id === 'no-date')!
    const badDate = out.find((m) => m.id === 'bad-date')!
    expect(noDate.created).toBe(0)
    expect(noDate.releaseDate).toBeNull()
    expect(badDate.created).toBe(0)
    expect(badDate.releaseDate).toBeNull()
  })

  it('sorts by created desc, tiebreaks by id asc', () => {
    const raw: RawModelsDevResponse = {
      anthropic: {
        models: {
          'claude-old':    { name: 'Old',    release_date: '2024-01-01' },
          'claude-newest': { name: 'Newest', release_date: '2025-11-01' },
          'claude-mid-b':  { name: 'Mid B',  release_date: '2025-06-01' },
          'claude-mid-a':  { name: 'Mid A',  release_date: '2025-06-01' },
        },
      },
    }
    const ids = extractAnthropicModels(raw).map((m) => m.id)
    expect(ids).toEqual([
      'claude-newest',
      'claude-mid-a',
      'claude-mid-b',
      'claude-old',
    ])
  })
})

describe('toOpenAiList', () => {
  it('shapes ModelEntry[] into { object: "list", data: ModelInfo[] }', () => {
    const list = toOpenAiList([
      {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        releaseDate: '2025-09-29',
        created: 1759104000,
        ownedBy: 'anthropic',
      },
    ])
    expect(list).toEqual({
      object: 'list',
      data: [
        {
          id: 'claude-sonnet-4-5',
          object: 'model',
          created: 1759104000,
          owned_by: 'anthropic',
        },
      ],
    })
  })

  it('handles empty input', () => {
    expect(toOpenAiList([])).toEqual({ object: 'list', data: [] })
  })
})
