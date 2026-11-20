import type {
  AnthropicStreamEvent,
  OpenAIStreamChunk,
} from './types'

interface ToolCallTracker {
  id: string
  name: string
  arguments: string
}

interface MetricsData {
  model: string
  stop_reason: string | null
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  output_tokens: number
  messageId: string | null
  openAIId: string | null
}

// How thinking text is delivered to the OpenAI-style client:
//   - 'quote' (default): inline in `content` as a Markdown blockquote headed
//     "Thinking". Cursor on a custom base URL hides <think> and has no native
//     thought block for custom endpoints (its server maps none of the
//     reasoning fields below), so this is the only form it displays.
//   - 'reasoning_content': DeepSeek-style delta field (clients with a
//     dedicated reasoning UI).
//   - 'think': inline in `content`, wrapped in <think>…</think> (clients that
//     render or hide think tags themselves).
//   - 'reasoning': both `reasoning_content` and OpenRouter-style `reasoning`
//     delta fields.
//   - 'off': dropped.
export type ReasoningFormat =
  | 'reasoning_content'
  | 'reasoning'
  | 'think'
  | 'quote'
  | 'off'

export const THINK_OPEN = '<think>\n'
export const THINK_CLOSE = '\n</think>\n\n'
export const QUOTE_OPEN = '> **Thinking**\n> '
export const QUOTE_CLOSE = '\n\n'

function inlineMarkers(format: ReasoningFormat): { open: string; close: string } {
  return format === 'think'
    ? { open: THINK_OPEN, close: THINK_CLOSE }
    : { open: QUOTE_OPEN, close: QUOTE_CLOSE }
}

export interface ConverterOptions {
  reasoningFormat?: ReasoningFormat
}

export interface ConverterState {
  reasoningFormat: ReasoningFormat
  // 'think' mode: a <think> tag has been opened and not yet closed.
  thinkOpen: boolean
  toolCallsTracker: Map<number, ToolCallTracker>
  metricsData: MetricsData
  // Holds the tail of the input that hasn't yet been terminated by a '\n'.
  // TCP/HTTP reads don't respect SSE line framing, so a `data: {...}` line
  // (and the JSON string inside it) can be split across two separate
  // `processChunk` calls. Without carrying this over, the trailing partial
  // line in one call and the leading partial line in the next both fail
  // JSON.parse independently and are silently dropped — the bug this buffer
  // fixes.
  pendingLine: string
  // Whether any reasoning_content has been emitted, and whether the current
  // thinking block has started emitting — separate blocks (e.g. progress
  // notes between tool calls) are joined with a blank line.
  reasoningEmitted: boolean
  thinkingBlockStarted: boolean
  // Per-response counters for diagnostics (logged by the route).
  stats: {
    reasoningChars: number
    textChars: number
    toolCalls: number
    // Tool-argument streaming: number of deltas, total chars, and the
    // longest silence before/between them (ms) — a single huge delta after a
    // long gap means arguments were buffered upstream.
    toolArgDeltas: number
    toolArgChars: number
    toolArgMaxGapMs: number
  }
  lastToolEventAt: number
}

export interface ProcessResult {
  type: 'chunk' | 'done'
  data?: OpenAIStreamChunk
}

export function createConverterState(
  options: ConverterOptions = {},
): ConverterState {
  return {
    reasoningFormat: options.reasoningFormat ?? 'quote',
    thinkOpen: false,
    toolCallsTracker: new Map(),
    metricsData: {
      model: '',
      stop_reason: null,
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      messageId: null,
      openAIId: null,
    },
    pendingLine: '',
    reasoningEmitted: false,
    thinkingBlockStarted: false,
    stats: {
      reasoningChars: 0,
      textChars: 0,
      toolCalls: 0,
      toolArgDeltas: 0,
      toolArgChars: 0,
      toolArgMaxGapMs: 0,
    },
    lastToolEventAt: 0,
  }
}

// Parse an SSE chunk from Anthropic and emit the corresponding OpenAI
// chat.completion.chunk events. The state is mutated across calls, allowing
// the caller to feed arbitrarily-split network buffers.
//
// Network reads can split a `data: {...}` line anywhere, including in the
// middle of the JSON payload — not just at line boundaries. To handle this,
// only the last line of each input chunk is treated as possibly-incomplete:
// it's held in `state.pendingLine` and prepended to the next call's input
// instead of being parsed immediately. All earlier lines end with a '\n' we
// just saw, so they're safe to parse right away.
export function processChunk(
  state: ConverterState,
  chunk: string,
  enableLogging: boolean = false,
): ProcessResult[] {
  const results: ProcessResult[] = []
  const combined = state.pendingLine + chunk
  const lines = combined.split('\n')
  // The last element is either '' (input ended with '\n', all lines complete)
  // or a partial line that hasn't been terminated yet — hold it for next time.
  state.pendingLine = lines.pop() ?? ''

  for (const line of lines) {
    const result = parseLine(state, line, enableLogging)
    results.push(...result)
  }

  return results
}

/**
 * Process whatever is left in `state.pendingLine` as a final, terminated
 * line. Call this once after the upstream stream ends (reader signals
 * `done`), in case the very last SSE line wasn't followed by a trailing
 * newline — otherwise it would sit in the buffer forever and its content
 * would be silently lost.
 */
export function flushPendingLine(
  state: ConverterState,
  enableLogging: boolean = false,
): ProcessResult[] {
  if (state.pendingLine === '') return []
  const line = state.pendingLine
  state.pendingLine = ''
  return parseLine(state, line, enableLogging)
}

function parseLine(
  state: ConverterState,
  line: string,
  enableLogging: boolean,
): ProcessResult[] {
  const results: ProcessResult[] = []
  const trimmedLine = line.trim()
  if (trimmedLine === '') return results
  if (trimmedLine.startsWith('event:')) return results

  if (trimmedLine.startsWith('data: ') && trimmedLine.includes('{')) {
    try {
      const data: AnthropicStreamEvent = JSON.parse(
        trimmedLine.replace(/^data: /, ''),
      )

      if (data.type === 'ping' || data.type === 'content_block_stop') {
        return results
      }

      // Anything other than more thinking ends an open <think> section.
      if (state.thinkOpen && !isThinkingEvent(data)) {
        state.thinkOpen = false
        results.push({
          type: 'chunk',
          data: contentChunk(state, inlineMarkers(state.reasoningFormat).close),
        })
      }

      if (
        data.type === 'content_block_start' &&
        data.content_block?.type === 'text'
      ) {
        return results
      }

      updateMetrics(state.metricsData, data)

      const openAIChunk = transformToOpenAI(state, data, enableLogging)
      if (openAIChunk) {
        results.push({ type: 'chunk', data: openAIChunk })
      }

      if (data.type === 'message_stop') {
        const usageChunk = createUsageChunk(state)
        if (usageChunk) {
          results.push({ type: 'chunk', data: usageChunk })
        }
        results.push({ type: 'done' })
      }
    } catch (parseError) {
      if (enableLogging) {
        console.error('Parse error:', parseError)
      }
    }
  }

  return results
}

function isThinkingEvent(data: AnthropicStreamEvent): boolean {
  if (data.type === 'content_block_start') {
    return data.content_block?.type === 'thinking'
  }
  if (data.type === 'content_block_delta') {
    // thinking_delta or signature_delta (no text, no partial_json)
    return data.delta?.text === undefined && data.delta?.partial_json === undefined
  }
  return false
}

function contentChunk(state: ConverterState, content: string): OpenAIStreamChunk {
  return {
    id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: state.metricsData.model || 'claude-unknown',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  }
}

function updateMetrics(
  metricsData: MetricsData,
  data: AnthropicStreamEvent,
): void {
  if (data.type === 'message_start' && data.message) {
    metricsData.messageId = data.message.id
    if (data.message.model) metricsData.model = data.message.model
  }
  if (data.model) metricsData.model = data.model
  if (data.stop_reason) metricsData.stop_reason = data.stop_reason
  if (data.type === 'message_delta' && data?.delta?.stop_reason) {
    metricsData.stop_reason = data.delta.stop_reason
  }
  if (data.usage) {
    metricsData.input_tokens += data.usage.input_tokens || 0
    metricsData.output_tokens += data.usage.output_tokens || 0
    metricsData.cache_creation_input_tokens +=
      data.usage.cache_creation_input_tokens || 0
    metricsData.cache_read_input_tokens +=
      data.usage.cache_read_input_tokens || 0
  }
  if (data?.message?.usage) {
    if (data?.message?.model) metricsData.model = data.message.model
    metricsData.input_tokens += data.message.usage.input_tokens || 0
    metricsData.output_tokens += data.message.usage.output_tokens || 0
    metricsData.cache_creation_input_tokens +=
      data.message.usage.cache_creation_input_tokens || 0
    metricsData.cache_read_input_tokens +=
      data.message.usage.cache_read_input_tokens || 0
  }
  if (data?.message?.stop_reason) {
    metricsData.stop_reason = data.message.stop_reason
  }
}

function createUsageChunk(state: ConverterState): OpenAIStreamChunk | null {
  if (
    state.metricsData.input_tokens === 0 &&
    state.metricsData.output_tokens === 0
  ) {
    return null
  }
  return {
    id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: state.metricsData.model || 'claude-unknown',
    choices: [{ index: 0, delta: {}, finish_reason: null }],
    usage: {
      prompt_tokens: state.metricsData.input_tokens,
      completion_tokens: state.metricsData.output_tokens,
      total_tokens:
        state.metricsData.input_tokens + state.metricsData.output_tokens,
    },
  }
}

function transformToOpenAI(
  state: ConverterState,
  data: AnthropicStreamEvent,
  enableLogging: boolean,
): OpenAIStreamChunk | null {
  if (data.type === 'message_start' && data.message) {
    const openAIId = 'chatcmpl-' + data.message.id.replace('msg_', '')
    state.metricsData.openAIId = openAIId
    return {
      id: openAIId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: data.message.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    }
  }

  if (
    data.type === 'content_block_start' &&
    data.content_block?.type === 'tool_use'
  ) {
    state.stats.toolCalls++
    state.lastToolEventAt = Date.now()
    state.toolCallsTracker.set(data.index ?? 0, {
      id: data.content_block.id ?? '',
      name: data.content_block.name ?? '',
      arguments: '',
    })
    return {
      id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: state.metricsData.model || 'claude-unknown',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: data.index ?? 0,
                id: data.content_block.id,
                type: 'function',
                function: {
                  name: data.content_block.name,
                  arguments: '',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }
  }

  if (data.type === 'content_block_delta' && data.delta?.partial_json) {
    const toolCall = state.toolCallsTracker.get(data.index ?? 0)
    if (!toolCall) return null
    const now = Date.now()
    state.stats.toolArgDeltas++
    state.stats.toolArgChars += data.delta.partial_json.length
    if (state.lastToolEventAt > 0) {
      state.stats.toolArgMaxGapMs = Math.max(
        state.stats.toolArgMaxGapMs,
        now - state.lastToolEventAt,
      )
    }
    state.lastToolEventAt = now
    let newPart = ''
    if (
      toolCall.arguments &&
      data.delta.partial_json.startsWith(toolCall.arguments)
    ) {
      newPart = data.delta.partial_json.substring(toolCall.arguments.length)
      toolCall.arguments = data.delta.partial_json
    } else {
      newPart = data.delta.partial_json
      toolCall.arguments += data.delta.partial_json
    }
    if (enableLogging) {
      console.log('[stream-converter] tool args delta', {
        index: data.index,
        newPart,
      })
    }
    return {
      id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: state.metricsData.model || 'claude-unknown',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: data.index ?? 0,
                function: { arguments: newPart },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }
  }

  if (
    data.type === 'content_block_start' &&
    data.content_block?.type === 'thinking'
  ) {
    state.thinkingBlockStarted = false
    return null
  }

  // Thinking text (summaries and between-tool progress notes). Empty under
  // display "omitted"; signature_delta events carry no text and are skipped.
  if (data.type === 'content_block_delta' && data.delta?.thinking) {
    state.stats.reasoningChars += data.delta.thinking.length
    if (state.reasoningFormat === 'off') return null
    let text = data.delta.thinking
    if (!state.thinkingBlockStarted) {
      if (state.reasoningEmitted) text = '\n\n' + text
      state.thinkingBlockStarted = true
    }
    state.reasoningEmitted = true
    if (state.reasoningFormat === 'think' || state.reasoningFormat === 'quote') {
      let opened = false
      if (!state.thinkOpen) {
        state.thinkOpen = true
        opened = true
        // A fresh section needs no leading separator.
        text = text.replace(/^\n\n/, '')
      }
      if (state.reasoningFormat !== 'think') {
        // Keep every line inside the blockquote.
        text = text.replace(/\n/g, '\n> ')
      }
      if (opened) text = inlineMarkers(state.reasoningFormat).open + text
      return contentChunk(state, text)
    }
    return {
      id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: state.metricsData.model || 'claude-unknown',
      choices: [
        {
          index: 0,
          delta:
            state.reasoningFormat === 'reasoning'
              ? { reasoning_content: text, reasoning: text }
              : { reasoning_content: text },
          finish_reason: null,
        },
      ],
    }
  }

  if (data.type === 'content_block_delta' && data.delta?.text) {
    state.stats.textChars += data.delta.text.length
    return {
      id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: state.metricsData.model || 'claude-unknown',
      choices: [
        { index: 0, delta: { content: data.delta.text }, finish_reason: null },
      ],
    }
  }

  if (data.type === 'message_delta' && data.delta?.stop_reason) {
    return {
      id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: state.metricsData.model || 'claude-unknown',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason:
            data.delta.stop_reason === 'end_turn'
              ? 'stop'
              : data.delta.stop_reason === 'tool_use'
              ? 'tool_calls'
              : data.delta.stop_reason,
        },
      ],
    }
  }

  return null
}
