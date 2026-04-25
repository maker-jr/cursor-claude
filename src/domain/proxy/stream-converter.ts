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

export interface ConverterState {
  toolCallsTracker: Map<number, ToolCallTracker>
  metricsData: MetricsData
}

export interface ProcessResult {
  type: 'chunk' | 'done'
  data?: OpenAIStreamChunk
}

export function createConverterState(): ConverterState {
  return {
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
  }
}

// Parse an SSE chunk from Anthropic and emit the corresponding OpenAI
// chat.completion.chunk events. The state is mutated across calls, allowing
// the caller to feed arbitrarily-split network buffers.
export function processChunk(
  state: ConverterState,
  chunk: string,
  enableLogging: boolean = false,
): ProcessResult[] {
  const results: ProcessResult[] = []
  const lines = chunk.split('\n')

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (trimmedLine === '') continue
    if (trimmedLine.startsWith('event:')) continue

    if (trimmedLine.startsWith('data: ') && trimmedLine.includes('{')) {
      try {
        const data: AnthropicStreamEvent = JSON.parse(
          trimmedLine.replace(/^data: /, ''),
        )

        if (data.type === 'ping' || data.type === 'content_block_stop') continue

        if (
          data.type === 'content_block_start' &&
          data.content_block?.type === 'text'
        ) {
          continue
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
  }

  return results
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

  if (data.type === 'content_block_delta' && data.delta?.text) {
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
