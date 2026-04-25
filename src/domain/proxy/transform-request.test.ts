import { describe, expect, it } from 'vitest'
import { stripOpenAiOnlyFields, transformRequest } from './transform-request'
import { OPENAI_ONLY_BODY_KEYS, CLAUDE_CODE_SYSTEM_MARKER } from './policies'
import type { AnthropicRequestBody } from './types'

describe('stripOpenAiOnlyFields', () => {
  it('removes every OpenAI-only key from the body', () => {
    const body: Record<string, unknown> = {
      model: 'claude-sonnet-4-20250514',
      messages: [],
    }
    for (const key of OPENAI_ONLY_BODY_KEYS) {
      body[key] = 'something'
    }
    stripOpenAiOnlyFields(body)
    for (const key of OPENAI_ONLY_BODY_KEYS) {
      expect(body[key]).toBeUndefined()
    }
    expect(body.model).toBe('claude-sonnet-4-20250514')
  })
})

describe('transformRequest', () => {
  it('passes through a native claude-code request untouched (no transform flag)', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-sonnet-4-20250514',
      system: [{ type: 'text', text: CLAUDE_CODE_SYSTEM_MARKER + ' Hi.' }],
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 500,
    }
    const result = transformRequest(body)
    expect(result.transformToOpenAIFormat).toBe(false)
    expect(body.max_tokens).toBe(500)
    expect(body.system?.[0].text).toContain(CLAUDE_CODE_SYSTEM_MARKER)
  })

  it('injects the marker and pins opus max_tokens=32000', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-20250514',
      messages: [{ role: 'user', content: 'hi' }],
    }
    const result = transformRequest(body)
    expect(result.transformToOpenAIFormat).toBe(true)
    expect(body.system?.[0].text).toBe(CLAUDE_CODE_SYSTEM_MARKER)
    expect(body.max_tokens).toBe(32_000)
  })

  it('injects the marker and pins sonnet max_tokens=64000', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'hi' }],
    }
    const result = transformRequest(body)
    expect(result.transformToOpenAIFormat).toBe(true)
    expect(body.max_tokens).toBe(64_000)
  })

  it('moves role=system messages into body.system and drops them from messages', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'hi' },
      ],
    }
    transformRequest(body)
    expect(body.messages?.map((m) => (m as any).role)).toEqual(['user'])
    const texts = body.system?.map((s) => s.text) ?? []
    expect(texts[0]).toBe(CLAUDE_CODE_SYSTEM_MARKER)
    expect(texts).toContain('Be brief.')
  })

  it('strips OpenAI-only fields before any other transform', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'hi' }],
      stream_options: { include_usage: true },
      frequency_penalty: 1,
    } as AnthropicRequestBody
    transformRequest(body)
    expect((body as any).stream_options).toBeUndefined()
    expect((body as any).frequency_penalty).toBeUndefined()
  })

  it('does not pin max_tokens for unknown model families', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-unknown-model',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 123,
    }
    transformRequest(body)
    expect(body.max_tokens).toBe(123)
  })

  it('initializes metadata when missing in transformed-path', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'hi' }],
    }
    transformRequest(body)
    expect(body.metadata).toEqual({})
  })

  it('returns without transforming when messages are absent', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-sonnet-4-20250514',
    } as AnthropicRequestBody
    const result = transformRequest(body)
    expect(result.transformToOpenAIFormat).toBe(false)
  })
})
