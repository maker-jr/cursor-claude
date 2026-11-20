import {
  CLAUDE_CODE_SYSTEM_MARKER,
  OPENAI_ONLY_BODY_KEYS,
  SAMPLING_BODY_KEYS,
  allowsSamplingParams,
  defaultMaxTokensForModel,
} from './policies'
import { applyThinkingDisplay } from './extended-thinking'
import { applyFastMode, type FastModeResult } from './fast-mode'
import type { AnthropicRequestBody } from './types'

export function stripOpenAiOnlyFields(body: Record<string, unknown>): void {
  for (const key of OPENAI_ONLY_BODY_KEYS) {
    delete body[key]
  }
}

// For streamed requests, stream each custom tool's input as it is generated
// instead of letting the API buffer a whole parameter (e.g. an entire file
// edit) before emitting it. Server tools (typed, no input_schema) reject the
// field, so only plain custom tools get it.
export function applyEagerInputStreaming(body: AnthropicRequestBody): void {
  if (body.stream !== true || !Array.isArray(body.tools)) return
  for (const tool of body.tools as Array<Record<string, unknown>>) {
    if (tool == null || typeof tool !== 'object') continue
    const isCustom = tool.type === undefined || tool.type === 'custom'
    if (isCustom && tool.input_schema && !('eager_input_streaming' in tool)) {
      tool.eager_input_streaming = true
    }
  }
}

// OpenAI-style clients may echo reasoning back on assistant messages; the
// Messages API rejects unknown message keys.
const ECHOED_REASONING_KEYS = ['reasoning_content', 'reasoning'] as const

const THINK_SECTION = /<think>[\s\S]*?<\/think>\s*/g
// 'quote' mode: "> **Thinking**" followed by consecutive "> " lines.
const QUOTE_THINKING_SECTION = /^> \*\*Thinking\*\*\n(?:>.*(?:\n|$))*\n*/gm

function stripThinking(text: string): string {
  return text.replace(THINK_SECTION, '').replace(QUOTE_THINKING_SECTION, '')
}

// In 'think' reasoning mode the client stores our <think>…</think> output as
// ordinary assistant text and sends it back next turn. Strip it so old
// reasoning isn't replayed to the model as if it were the reply.
export function stripEchoedThinkSections(
  messages: Array<Record<string, unknown>>,
): void {
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    if (typeof msg.content === 'string') {
      msg.content = stripThinking(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          block.text = stripThinking(block.text)
        }
      }
      // An emptied text block is a 400 ("text content blocks must be non-empty").
      msg.content = (msg.content as Array<Record<string, unknown>>).filter(
        (b) => !(b?.type === 'text' && b.text === ''),
      )
    }
  }
}

export interface TransformRequestResult {
  body: AnthropicRequestBody
  transformToOpenAIFormat: boolean
  fastMode: FastModeResult
}

// Normalize an incoming /v1/chat/completions or /v1/messages body into the
// Anthropic Messages shape.
//
// If the caller is already native claude-code (system[0].text starts with the
// Claude Code marker), we forward as-is. Otherwise we:
//   - Drop OpenAI-only fields that Anthropic rejects.
//   - Move any role=system messages into body.system.
//   - Prepend the claude-code marker to body.system (required for OAuth scope).
//   - Pin max_tokens to the per-model default if not already capped.
//
//   - Request summarized thinking (streamed back as reasoning_content) and
//     eager tool-input streaming, so Cursor shows thoughts and edits live.
//
// Fast mode (`speed: "fast"`) is resolved for every caller, native included:
// it is set when requested and supported, and dropped otherwise.
//
// This function mutates + returns the body. Pure in the sense that it doesn't
// touch I/O or globals.
export function transformRequest(body: AnthropicRequestBody): TransformRequestResult {
  // Must read `service_tier` (Cursor's fast toggle) before it is stripped.
  const fastMode = applyFastMode(body)
  stripOpenAiOnlyFields(body as unknown as Record<string, unknown>)

  // Applies to every caller (including native claude-code): these params are
  // a hard 400 on models that removed them, so forwarding is never useful.
  if (!allowsSamplingParams(body.model)) {
    for (const key of SAMPLING_BODY_KEYS) {
      delete (body as unknown as Record<string, unknown>)[key]
    }
  }

  const alreadyClaudeCode = Boolean(
    body.system?.[0]?.text?.includes(CLAUDE_CODE_SYSTEM_MARKER),
  )
  if (alreadyClaudeCode || !body.messages) {
    return { body, transformToOpenAIFormat: false, fastMode }
  }

  const systemMessages = body.messages.filter(
    (msg) => (msg as { role?: string }).role === 'system',
  )
  body.messages = body.messages.filter(
    (msg) => (msg as { role?: string }).role !== 'system',
  )
  for (const msg of body.messages) {
    for (const key of ECHOED_REASONING_KEYS) delete msg[key]
  }
  stripEchoedThinkSections(body.messages)

  if (!body.system) {
    body.system = []
  }
  body.system.unshift({
    type: 'text',
    text: CLAUDE_CODE_SYSTEM_MARKER,
  })

  for (const sysMsg of systemMessages) {
    body.system.push({
      type: 'text',
      text: String((sysMsg as { content?: unknown }).content ?? ''),
    })
  }

  const cap = defaultMaxTokensForModel(body.model)
  if (cap != null) {
    body.max_tokens = cap
  }

  applyThinkingDisplay(body)
  applyEagerInputStreaming(body)

  if (!body.metadata) {
    body.metadata = {}
  }

  return { body, transformToOpenAIFormat: true, fastMode }
}
