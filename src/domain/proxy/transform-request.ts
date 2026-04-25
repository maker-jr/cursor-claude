import {
  CLAUDE_CODE_SYSTEM_MARKER,
  OPENAI_ONLY_BODY_KEYS,
  defaultMaxTokensForModel,
} from './policies'
import type { AnthropicRequestBody } from './types'

export function stripOpenAiOnlyFields(body: Record<string, unknown>): void {
  for (const key of OPENAI_ONLY_BODY_KEYS) {
    delete body[key]
  }
}

export interface TransformRequestResult {
  body: AnthropicRequestBody
  transformToOpenAIFormat: boolean
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
// This function mutates + returns the body. Pure in the sense that it doesn't
// touch I/O or globals.
export function transformRequest(body: AnthropicRequestBody): TransformRequestResult {
  stripOpenAiOnlyFields(body as unknown as Record<string, unknown>)

  const alreadyClaudeCode = Boolean(
    body.system?.[0]?.text?.includes(CLAUDE_CODE_SYSTEM_MARKER),
  )
  if (alreadyClaudeCode || !body.messages) {
    return { body, transformToOpenAIFormat: false }
  }

  const systemMessages = body.messages.filter(
    (msg) => (msg as { role?: string }).role === 'system',
  )
  body.messages = body.messages.filter(
    (msg) => (msg as { role?: string }).role !== 'system',
  )

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

  if (!body.metadata) {
    body.metadata = {}
  }

  return { body, transformToOpenAIFormat: true }
}
