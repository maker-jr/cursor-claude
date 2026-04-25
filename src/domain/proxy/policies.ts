// Policies and constants that drive request transformation and OAuth scoping.

// Cursor sends OpenAI Chat Completions fields; Anthropic Messages API rejects unknown keys.
export const OPENAI_ONLY_BODY_KEYS = [
  'stream_options',
  'frequency_penalty',
  'presence_penalty',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'n',
  'modalities',
  'prediction',
  'response_format',
  'seed',
  'service_tier',
  'store',
  'web_search_options',
] as const

export const CLAUDE_CODE_SYSTEM_MARKER =
  "You are Claude Code, Anthropic's official CLI for Claude."

// The proxy pins max_tokens for non-claude-code callers because Cursor and similar
// clients rarely send a conservative cap and Anthropic's upstream rejects excessive
// values depending on the model family.
export function defaultMaxTokensForModel(model: string): number | null {
  if (model.includes('opus')) return 32_000
  if (model.includes('sonnet')) return 64_000
  return null
}

export const OAUTH_SCOPES = 'org:create_api_key user:profile user:inference'

export const ANTHROPIC_BETA_HEADER =
  'oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14'
export const ANTHROPIC_VERSION = '2023-06-01'
export const USER_AGENT = '@anthropic-ai/sdk 1.2.12 node/22.13.1'
