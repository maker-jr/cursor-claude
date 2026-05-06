import { describe, expect, it } from 'vitest'
import { defaultMaxTokensForModel } from './policies'

describe('defaultMaxTokensForModel', () => {
  describe('opus models', () => {
    const opusIds = [
      'claude-opus-4-5',
      'claude-opus-4-5-20251101',
      'claude-opus-4-6',
      'claude-opus-4-6-20251101',
      'claude-opus-4-7',
      'claude-opus-4-7-20260101',
      'claude-opus-latest',
    ]
    for (const id of opusIds) {
      it(`returns 32_000 for ${id}`, () => {
        expect(defaultMaxTokensForModel(id)).toBe(32_000)
      })
    }
  })

  describe('sonnet models', () => {
    const sonnetIds = [
      'claude-sonnet-4-5',
      'claude-sonnet-4-5-20251101',
      'claude-sonnet-4-6',
      'claude-sonnet-4-6-20251101',
      'claude-sonnet-latest',
    ]
    for (const id of sonnetIds) {
      it(`returns 64_000 for ${id}`, () => {
        expect(defaultMaxTokensForModel(id)).toBe(64_000)
      })
    }
  })

  describe('haiku / unknown models', () => {
    it('returns null for haiku (not pinned)', () => {
      expect(defaultMaxTokensForModel('claude-haiku-4-5')).toBeNull()
    })

    it('returns null for an unrecognised model', () => {
      expect(defaultMaxTokensForModel('gpt-4o')).toBeNull()
    })
  })
})
