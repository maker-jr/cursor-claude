// Canonical Anthropic / OpenAI wire types used inside the proxy domain.
// Kept loose (index signatures) where we intentionally forward unknown keys.

export interface AnthropicRequestBody {
  system?: Array<{ type: string; text: string }>
  messages?: Array<Record<string, unknown>>
  metadata?: { user_id?: string }
  stream?: boolean
  model: string
  max_tokens?: number
  [key: string]: unknown
}

export interface AnthropicContentBlock {
  type: 'text' | 'tool_use'
  id?: string
  name?: string
  text?: string
  input?: unknown
}

export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export interface AnthropicResponse {
  id?: string
  model?: string
  stop_reason?: string | null
  content?: AnthropicContentBlock[]
  usage?: AnthropicUsage
  [key: string]: unknown
}

export interface AnthropicStreamEvent {
  type: string
  message?: {
    id: string
    model: string
    usage?: AnthropicUsage
    stop_reason?: string
  }
  content_block?: AnthropicContentBlock
  delta?: {
    text?: string
    partial_json?: string
    stop_reason?: string
  }
  index?: number
  model?: string
  stop_reason?: string
  usage?: AnthropicUsage
}

export interface OpenAIStreamChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface OpenAIResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string | null
      tool_calls: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
    finish_reason: string | null
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ModelInfo {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export interface ModelsListResponse {
  object: 'list'
  data: ModelInfo[]
}

export interface ErrorResponse {
  error: string
  message?: string
  details?: string
}

export interface SuccessResponse {
  success: boolean
  message: string
}
