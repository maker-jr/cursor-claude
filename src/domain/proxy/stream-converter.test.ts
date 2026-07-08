import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createConverterState, processChunk } from './stream-converter'

const fixtureDir = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'sse')
const loadFixture = (name: string) =>
  readFileSync(join(fixtureDir, name), 'utf8')

function convertAll(sse: string) {
  const state = createConverterState()
  return processChunk(state, sse)
}

describe('stream converter', () => {
  it('emits assistant role on message_start then content deltas then finish=stop, plus usage and done', () => {
    const results = convertAll(loadFixture('text-reply.sse'))
    expect(results.at(-1)?.type).toBe('done')
    const chunks = results.filter((r) => r.type === 'chunk').map((r) => r.data!)
    expect(chunks[0].choices[0].delta.role).toBe('assistant')
    const finish = chunks.find((c) => c.choices[0].finish_reason === 'stop')
    expect(finish).toBeTruthy()
    const usage = chunks.find((c) => c.usage)
    expect(usage?.usage?.prompt_tokens).toBeGreaterThan(0)
  })

  it('streams tool_call id/name then incremental argument strings', () => {
    const results = convertAll(loadFixture('tool-use.sse'))
    const chunks = results.filter((r) => r.type === 'chunk').map((r) => r.data!)
    const start = chunks.find(
      (c) => c.choices[0].delta.tool_calls?.[0]?.id === 'toolu_01AaBb',
    )
    expect(start).toBeTruthy()
    const args = chunks
      .map((c) => c.choices[0].delta.tool_calls?.[0]?.function?.arguments)
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .join('')
    expect(args).toBe('{"location":"Paris"}')
    expect(
      chunks.find((c) => c.choices[0].finish_reason === 'tool_calls'),
    ).toBeTruthy()
  })

  it('handles multi-block: emits text deltas then tool_call deltas', () => {
    const results = convertAll(loadFixture('multi-block.sse'))
    const chunks = results.filter((r) => r.type === 'chunk').map((r) => r.data!)
    const text = chunks
      .map((c) => c.choices[0].delta.content)
      .filter((t): t is string => typeof t === 'string')
      .join('')
    expect(text).toBe('Let me check the weather for you.')
  })

  it('ignores ping and content_block_stop events', () => {
    const state = createConverterState()
    const sse = [
      'event: ping',
      'data: {"type":"ping"}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
    ].join('\n')
    const results = processChunk(state, sse)
    expect(results).toEqual([])
  })

  it('tolerates chunks split across read boundaries (feed a single fixture in two halves)', () => {
    const sse = loadFixture('text-reply.sse')
    const mid = Math.floor(sse.length / 2)
    const state = createConverterState()
    const first = processChunk(state, sse.slice(0, mid))
    const second = processChunk(state, sse.slice(mid))
    // Each half should produce at least some results; the combined result should
    // contain a terminal `done`.
    const combined = [...first, ...second]
    expect(combined.at(-1)?.type).toBe('done')
  })

  it('reconstructs full text when a network read splits mid-JSON-string (not on a newline boundary)', () => {
    // Real TCP reads land anywhere, not just on '\n'. Split inside the
    // `data: {...}` line's JSON string itself to reproduce a realistic
    // mid-token split.
    const sse = loadFixture('text-reply.sse')
    const marker = '"text":"Hello'
    const splitPoint = sse.indexOf(marker) + marker.length - 2 // land mid-word
    expect(splitPoint).toBeGreaterThan(0)

    const state = createConverterState()
    const first = processChunk(state, sse.slice(0, splitPoint))
    const second = processChunk(state, sse.slice(splitPoint))
    const chunks = [...first, ...second]
      .filter((r) => r.type === 'chunk')
      .map((r) => r.data!)

    const text = chunks
      .map((c) => c.choices[0].delta.content)
      .filter((t): t is string => typeof t === 'string')
      .join('')
    expect(text).toBe('Hello, world!')
  })

  it('reconstructs full text when a split lands mid-JSON-string across multiple deltas (multi-block fixture)', () => {
    const sse = loadFixture('multi-block.sse')
    const marker = '"text":"Let me check'
    const splitPoint = sse.indexOf(marker) + marker.length - 3

    const state = createConverterState()
    const first = processChunk(state, sse.slice(0, splitPoint))
    const second = processChunk(state, sse.slice(splitPoint))
    const chunks = [...first, ...second]
      .filter((r) => r.type === 'chunk')
      .map((r) => r.data!)

    const text = chunks
      .map((c) => c.choices[0].delta.content)
      .filter((t): t is string => typeof t === 'string')
      .join('')
    expect(text).toBe('Let me check the weather for you.')
  })

  it('handles a chunk split into many small pieces (byte-by-byte-ish) without losing content', () => {
    const sse = loadFixture('text-reply.sse')
    const state = createConverterState()
    const pieceSize = 7
    const results: ReturnType<typeof processChunk> = []
    for (let i = 0; i < sse.length; i += pieceSize) {
      results.push(...processChunk(state, sse.slice(i, i + pieceSize)))
    }
    const chunks = results.filter((r) => r.type === 'chunk').map((r) => r.data!)
    const text = chunks
      .map((c) => c.choices[0].delta.content)
      .filter((t): t is string => typeof t === 'string')
      .join('')
    expect(text).toBe('Hello, world!')
    expect(results.at(-1)?.type).toBe('done')
  })
})
