import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertNonStreamingResponse } from '../../src/domain/proxy/transform-response'
import type { AnthropicResponse } from '../../src/domain/proxy/types'

function loadFixture(name: string): AnthropicResponse {
  const raw = readFileSync(
    join(__dirname, '..', 'fixtures', 'anthropic-response', name),
    'utf8',
  )
  return JSON.parse(raw) as AnthropicResponse
}

describe('characterization: convertNonStreamingResponse', () => {
  it('maps a plain text reply to OpenAI chat completion shape', () => {
    const result = convertNonStreamingResponse(loadFixture('text-reply.json'))

    expect(result.object).toBe('chat.completion')
    expect(result.model).toBe('claude-sonnet-4-20250514')
    expect(result.choices).toHaveLength(1)
    const choice = result.choices[0]
    expect(choice.index).toBe(0)
    expect(choice.message.role).toBe('assistant')
    expect(choice.message.content).toBe('Hello, world!')
    expect(choice.message.tool_calls).toEqual([])
    expect(choice.finish_reason).toBe('stop')

    expect(result.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 9,
      total_tokens: 21,
    })

    expect(result.id).toMatch(/^chatcmpl-/)
  })

  it('maps a tool_use reply to OpenAI tool_calls with finish_reason=tool_calls', () => {
    const result = convertNonStreamingResponse(loadFixture('tool-use.json'))

    const choice = result.choices[0]
    expect(choice.finish_reason).toBe('tool_calls')
    expect(choice.message.content).toBe(null)
    expect(choice.message.tool_calls).toHaveLength(1)
    const call = choice.message.tool_calls[0]
    expect(call.id).toBe('toolu_01EeFf')
    expect(call.type).toBe('function')
    expect(call.function.name).toBe('get_weather')
    expect(JSON.parse(call.function.arguments)).toEqual({ location: 'Lagos' })
  })

  it('maps multi-block (text + tool_use) retaining both pieces', () => {
    const result = convertNonStreamingResponse(loadFixture('multi-block.json'))
    const choice = result.choices[0]
    expect(choice.message.content).toBe('Let me check the weather for you.')
    expect(choice.message.tool_calls).toHaveLength(1)
    expect(choice.message.tool_calls[0].function.name).toBe('get_weather')
    expect(JSON.parse(choice.message.tool_calls[0].function.arguments)).toEqual({
      location: 'Tokyo',
    })
    expect(choice.finish_reason).toBe('tool_calls')
  })

  it('preserves unknown stop_reason values passthrough', () => {
    const result = convertNonStreamingResponse({
      id: 'msg_weird',
      model: 'claude-opus-4-20250514',
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    expect(result.choices[0].finish_reason).toBe('max_tokens')
  })
})
