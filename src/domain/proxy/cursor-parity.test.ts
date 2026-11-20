import { describe, expect, it } from 'vitest'
import { applyThinkingDisplay } from './extended-thinking'
import { createConverterState, processChunk } from './stream-converter'
import { convertNonStreamingResponse } from './transform-response'
import {
  applyEagerInputStreaming,
  stripEchoedThinkSections,
  transformRequest,
} from './transform-request'
import type { AnthropicRequestBody } from './types'

function body(extra: Record<string, unknown>): AnthropicRequestBody {
  return { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], ...extra }
}

describe('applyThinkingDisplay', () => {
  it('turns on summarized display for Claude 5 models (thinking on by default)', () => {
    const b = body({})
    applyThinkingDisplay(b)
    expect(b.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
  })

  it('adds display to an existing adaptive config on Opus 4.8', () => {
    const b = body({ model: 'claude-opus-4-8', thinking: { type: 'adaptive' } })
    applyThinkingDisplay(b)
    expect(b.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
  })

  it('does not turn thinking on for Opus 4.8 when it was off', () => {
    const b = body({ model: 'claude-opus-4-8' })
    applyThinkingDisplay(b)
    expect(b.thinking).toBeUndefined()
  })

  it('leaves 4.6 (already summarized by default) and legacy budget configs alone', () => {
    const a = body({ model: 'claude-sonnet-4-6', thinking: { type: 'adaptive' } })
    applyThinkingDisplay(a)
    expect(a.thinking).toEqual({ type: 'adaptive' })
    const c = body({ model: 'claude-sonnet-4-5', thinking: { type: 'enabled', budget_tokens: 8000 } })
    applyThinkingDisplay(c)
    expect(c.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 })
  })

  it('respects a client-chosen display and between_tools', () => {
    const a = body({ thinking: { type: 'adaptive', display: 'updates' } })
    applyThinkingDisplay(a)
    expect(a.thinking).toEqual({ type: 'adaptive', display: 'updates' })
    const b2 = body({ model: 'claude-sonnet-5-5', thinking: { type: 'between_tools' } })
    applyThinkingDisplay(b2)
    expect(b2.thinking).toEqual({ type: 'between_tools' })
  })
})

describe('applyEagerInputStreaming', () => {
  const tools = () => [
    { name: 'edit_file', input_schema: { type: 'object' } },
    { type: 'custom', name: 'run', input_schema: { type: 'object' } },
    { type: 'web_search_20260209', name: 'web_search' },
    { name: 'opt_out', input_schema: { type: 'object' }, eager_input_streaming: false },
  ]

  it('sets eager_input_streaming on custom tools of streamed requests only', () => {
    const b = body({ stream: true, tools: tools() })
    applyEagerInputStreaming(b)
    const t = b.tools as Array<Record<string, unknown>>
    expect(t[0].eager_input_streaming).toBe(true)
    expect(t[1].eager_input_streaming).toBe(true)
    expect(t[2]).not.toHaveProperty('eager_input_streaming')
    expect(t[3].eager_input_streaming).toBe(false)
  })

  it('does nothing for non-streamed requests', () => {
    const b = body({ tools: tools() })
    applyEagerInputStreaming(b)
    expect((b.tools as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'eager_input_streaming',
    )
  })
})

describe('transformRequest — Cursor parity', () => {
  it('strips echoed reasoning fields from messages', () => {
    const b = body({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'ok', reasoning_content: 'thought', reasoning: 'x' },
      ],
    })
    transformRequest(b)
    expect(b.messages?.[1]).toEqual({ role: 'assistant', content: 'ok' })
  })
})

function sse(events: object[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
}

describe('stream converter — reasoning_content', () => {
  it('streams thinking as reasoning_content, separating blocks, before tool calls', () => {
    const state = createConverterState({ reasoningFormat: 'reasoning_content' })
    const out = processChunk(
      state,
      sse([
        { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-5-5' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan ' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'it.' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'Editing the config next.' } },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'edit_file' } },
      ]),
    )
    const reasoning = out
      .map((r) => r.data?.choices[0].delta.reasoning_content)
      .filter((x) => x !== undefined)
    expect(reasoning).toEqual(['Plan ', 'it.', '\n\nEditing the config next.'])
    expect(out.at(-1)?.data?.choices[0].delta.tool_calls?.[0].function?.name).toBe('edit_file')
  })

  it('emits nothing for empty (omitted) thinking blocks', () => {
    const state = createConverterState()
    const out = processChunk(
      state,
      sse([
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
      ]),
    )
    expect(out).toEqual([])
  })
})

describe('non-streaming — reasoning_content', () => {
  it('collects thinking blocks into message.reasoning_content', () => {
    const res = convertNonStreamingResponse({
      id: 'msg_1',
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'A' },
        { type: 'thinking', thinking: '' },
        { type: 'thinking', thinking: 'B' },
        { type: 'text', text: 'done' },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }, 'reasoning_content')
    expect(res.choices[0].message.reasoning_content).toBe('A\n\nB')
    expect(res.choices[0].message.content).toBe('done')
  })
})

describe("stream converter — 'think' reasoning format", () => {
  it('wraps thinking in <think> inside content and closes it before the reply', () => {
    const state = createConverterState({ reasoningFormat: 'think' })
    const out = processChunk(
      state,
      sse([
        { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-5-5' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan.' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 's' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'More.' } },
        { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Answer' } },
        { type: 'content_block_start', index: 3, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 3, delta: { type: 'thinking_delta', thinking: 'Next: edit.' } },
        { type: 'content_block_start', index: 4, content_block: { type: 'tool_use', id: 't1', name: 'edit_file' } },
      ]),
    )
    const content = out
      .map((r) => r.data?.choices[0].delta.content)
      .filter((x) => x !== undefined)
      .join('')
    expect(content).toBe(
      '<think>\nPlan.\n\nMore.\n</think>\n\nAnswer<think>\nNext: edit.\n</think>\n\n',
    )
    expect(out.some((r) => r.data?.choices[0].delta.reasoning_content)).toBe(false)
    expect(out.at(-1)?.data?.choices[0].delta.tool_calls?.[0].function?.name).toBe('edit_file')
  })

  it("'off' drops thinking entirely", () => {
    const state = createConverterState({ reasoningFormat: 'off' })
    const out = processChunk(
      state,
      sse([
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x' } },
      ]),
    )
    expect(out).toEqual([])
  })
})

describe('stripEchoedThinkSections', () => {
  it('removes <think> sections from assistant strings and text blocks', () => {
    const messages: Array<Record<string, unknown>> = [
      { role: 'user', content: 'keep <think>user text</think>' },
      { role: 'assistant', content: '<think>\nA\n</think>\n\nReply' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '<think>\nB\n</think>\n\n' },
          { type: 'tool_use', id: 't', name: 'x', input: {} },
        ],
      },
    ]
    stripEchoedThinkSections(messages)
    expect(messages[0].content).toBe('keep <think>user text</think>')
    expect(messages[1].content).toBe('Reply')
    expect(messages[2].content).toEqual([{ type: 'tool_use', id: 't', name: 'x', input: {} }])
  })
})

describe('non-streaming — think format', () => {
  it('prepends a <think> section to content', () => {
    const res = convertNonStreamingResponse(
      {
        id: 'msg_1',
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: 'A' },
          { type: 'text', text: 'done' },
        ],
      },
      'think',
    )
    expect(res.choices[0].message.content).toBe('<think>\nA\n</think>\n\ndone')
    expect(res.choices[0].message.reasoning_content).toBeUndefined()
  })
})

describe("'quote' reasoning format", () => {
  it('streams thinking as a blockquote and closes it before the reply', () => {
    const state = createConverterState({ reasoningFormat: 'quote' })
    const out = processChunk(
      state,
      sse([
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Line one.\nLine' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' two.' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'Next.' } },
        { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Answer' } },
      ]),
    )
    const content = out.map((r) => r.data?.choices[0].delta.content ?? '').join('')
    expect(content).toBe(
      '> **Thinking**\n> Line one.\n> Line two.\n> \n> Next.\n\nAnswer',
    )
  })

  it('round-trips: the echoed blockquote is stripped from history', () => {
    const messages: Array<Record<string, unknown>> = [
      {
        role: 'assistant',
        content: '> **Thinking**\n> Line one.\n> Line two.\n> \n> Next.\n\nAnswer',
      },
      { role: 'assistant', content: '> a normal quote\n\nkept' },
    ]
    stripEchoedThinkSections(messages)
    expect(messages[0].content).toBe('Answer')
    expect(messages[1].content).toBe('> a normal quote\n\nkept')
  })
})
