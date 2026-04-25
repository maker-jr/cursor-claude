import type { AnthropicResponse, OpenAIResponse } from './types'

// Convert a non-streaming Anthropic Messages response into OpenAI chat.completion
// shape. Pure function: no clock, no randomness apart from Date.now() and
// that's fine for wire-level fidelity.
export function convertNonStreamingResponse(
  anthropicResponse: AnthropicResponse,
): OpenAIResponse {
  const openAIResponse: OpenAIResponse = {
    id:
      'chatcmpl-' +
      (anthropicResponse.id || Date.now()).toString().replace('msg_', ''),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: anthropicResponse.model || 'claude-unknown',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [],
        },
        finish_reason:
          anthropicResponse.stop_reason === 'end_turn'
            ? 'stop'
            : anthropicResponse.stop_reason === 'tool_use'
            ? 'tool_calls'
            : anthropicResponse.stop_reason || null,
      },
    ],
    usage: {
      prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
      completion_tokens: anthropicResponse.usage?.output_tokens || 0,
      total_tokens:
        (anthropicResponse.usage?.input_tokens || 0) +
        (anthropicResponse.usage?.output_tokens || 0),
    },
  }

  let textContent = ''
  for (const block of anthropicResponse.content || []) {
    if (block.type === 'text') {
      textContent += block.text
    } else if (block.type === 'tool_use' && block.id && block.name) {
      openAIResponse.choices[0].message.tool_calls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      })
    }
  }

  if (textContent) {
    openAIResponse.choices[0].message.content = textContent
  }

  return openAIResponse
}
