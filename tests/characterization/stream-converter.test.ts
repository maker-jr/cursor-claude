import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createConverterState,
  processChunk,
} from '../../src/domain/proxy/stream-converter'

const fixtureDir = join(__dirname, '..', 'fixtures', 'sse')

function readFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8')
}

function convert(sse: string): Array<{ type: 'chunk' | 'done'; data?: any }> {
  const state = createConverterState()
  return processChunk(state, sse)
}

describe('characterization: stream converter', () => {
  it('text-reply: emits role + content deltas + finish_reason + usage + done', () => {
    const results = convert(readFixture('text-reply.sse'))

    expect(results.at(-1)?.type).toBe('done')

    const chunks = results.filter((r) => r.type === 'chunk').map((r) => r.data)

    const first = chunks[0]
    expect(first.choices[0].delta.role).toBe('assistant')
    expect(first.object).toBe('chat.completion.chunk')
    expect(first.model).toBe('claude-sonnet-4-20250514')

    const texts = chunks
      .map((c) => c.choices?.[0]?.delta?.content)
      .filter((t) => typeof t === 'string' && t.length > 0)
    expect(texts.join('')).toBe('Hello, world!')

    const finish = chunks.find((c) => c.choices?.[0]?.finish_reason === 'stop')
    expect(finish).toBeTruthy()

    const usage = chunks.find((c) => c.usage)
    expect(usage?.usage).toMatchObject({
      prompt_tokens: 12,
      completion_tokens: 10,
      total_tokens: 22,
    })
  })

  it('tool-use: emits tool_calls delta with incremental arguments and tool_calls finish reason', () => {
    const results = convert(readFixture('tool-use.sse'))
    const chunks = results.filter((r) => r.type === 'chunk').map((r) => r.data)

    const start = chunks.find(
      (c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.id === 'toolu_01AaBb',
    )
    expect(start).toBeTruthy()
    expect(start.choices[0].delta.tool_calls[0].function.name).toBe('get_weather')

    const argDeltas = chunks
      .map((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments)
      .filter((a): a is string => typeof a === 'string' && a.length > 0)
    expect(argDeltas.join('')).toBe('{"location":"Paris"}')

    const finish = chunks.find((c) => c.choices?.[0]?.finish_reason === 'tool_calls')
    expect(finish).toBeTruthy()

    expect(results.at(-1)?.type).toBe('done')
  })

  it('multi-block: emits text deltas followed by tool_call deltas', () => {
    const results = convert(readFixture('multi-block.sse'))
    const chunks = results.filter((r) => r.type === 'chunk').map((r) => r.data)

    const textContent = chunks
      .map((c) => c.choices?.[0]?.delta?.content)
      .filter((t) => typeof t === 'string' && t.length > 0)
      .join('')
    expect(textContent).toBe('Let me check the weather for you.')

    const argChunks = chunks.filter(
      (c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments !== undefined,
    )
    const args = argChunks
      .map((c) => c.choices[0].delta.tool_calls[0].function.arguments)
      .join('')
    expect(args).toBe('{"location":"Tokyo"}')

    const finish = chunks.find((c) => c.choices?.[0]?.finish_reason === 'tool_calls')
    expect(finish).toBeTruthy()

    expect(results.at(-1)?.type).toBe('done')
  })
})
