import { describe, expect, it } from 'vitest'
import { convertNonStreamingResponse } from './transform-response'

describe('convertNonStreamingResponse', () => {
  it('maps text content + end_turn to OpenAI stop', () => {
    const out = convertNonStreamingResponse({
      id: 'msg_abc',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'Hello' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    })
    expect(out.object).toBe('chat.completion')
    expect(out.model).toBe('claude-sonnet-4-20250514')
    expect(out.choices[0].message.content).toBe('Hello')
    expect(out.choices[0].message.tool_calls).toEqual([])
    expect(out.choices[0].finish_reason).toBe('stop')
    expect(out.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 2,
      total_tokens: 7,
    })
    expect(out.id.startsWith('chatcmpl-')).toBe(true)
    expect(out.id).toContain('abc')
  })

  it('maps tool_use to OpenAI tool_calls + tool_calls finish_reason', () => {
    const out = convertNonStreamingResponse({
      id: 'msg_xyz',
      model: 'claude-opus-4-20250514',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'search',
          input: { q: 'hi' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 3, output_tokens: 4 },
    })
    expect(out.choices[0].finish_reason).toBe('tool_calls')
    expect(out.choices[0].message.content).toBeNull()
    expect(out.choices[0].message.tool_calls).toHaveLength(1)
    expect(out.choices[0].message.tool_calls[0]).toMatchObject({
      id: 'toolu_1',
      type: 'function',
      function: { name: 'search' },
    })
    expect(
      JSON.parse(out.choices[0].message.tool_calls[0].function.arguments),
    ).toEqual({ q: 'hi' })
  })

  it('handles missing usage with zeros', () => {
    const out = convertNonStreamingResponse({
      id: 'msg_nou',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'x' }],
      stop_reason: 'end_turn',
    })
    expect(out.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    })
  })

  it('passes through unknown stop_reason values', () => {
    const out = convertNonStreamingResponse({
      id: 'msg_q',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'x' }],
      stop_reason: 'max_tokens',
    })
    expect(out.choices[0].finish_reason).toBe('max_tokens')
  })

  it('combines text and tool_use blocks in multi-block response', () => {
    const out = convertNonStreamingResponse({
      id: 'msg_m',
      model: 'claude-sonnet-4-20250514',
      content: [
        { type: 'text', text: 'Part one.' },
        { type: 'tool_use', id: 't', name: 'n', input: {} },
      ],
      stop_reason: 'tool_use',
    })
    expect(out.choices[0].message.content).toBe('Part one.')
    expect(out.choices[0].message.tool_calls).toHaveLength(1)
  })
})
