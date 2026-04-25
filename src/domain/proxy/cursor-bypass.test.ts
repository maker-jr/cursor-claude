import { describe, expect, it } from 'vitest'
import {
  createCursorBypassResponse,
  isCursorKeyCheck,
} from './cursor-bypass'

describe('isCursorKeyCheck', () => {
  it('matches requests with gpt-4o in the model name', () => {
    expect(isCursorKeyCheck({ model: 'gpt-4o-2024-08-06' })).toBe(true)
    expect(isCursorKeyCheck({ model: 'gpt-4o-mini' })).toBe(true)
  })

  it('matches the "Test prompt using gpt-3.5-turbo" probe', () => {
    expect(
      isCursorKeyCheck({
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: 'Test prompt using gpt-3.5-turbo' },
        ],
      }),
    ).toBe(true)
  })

  it('returns false for a normal Anthropic request', () => {
    expect(
      isCursorKeyCheck({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).toBe(false)
  })

  it('returns false for an unrelated gpt-3.5 request (no probe content)', () => {
    expect(
      isCursorKeyCheck({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).toBe(false)
  })
})

describe('createCursorBypassResponse', () => {
  it('returns an OpenAI-shaped chat.completion response', () => {
    const r = createCursorBypassResponse()
    expect(r.object).toBe('chat.completion')
    expect(r.model).toMatch(/gpt-4o/)
    expect(r.choices[0].message.role).toBe('assistant')
    expect(typeof r.choices[0].message.content).toBe('string')
  })
})
