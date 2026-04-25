export interface AnthropicFetchOptions {
  body: unknown
  accessToken: string
  streaming: boolean
  signal?: AbortSignal
}

export interface AnthropicFetchResponse {
  ok: boolean
  status: number
  // Raw response headers (lowercased keys).
  headers: Record<string, string>
  // When not ok, the error body text.
  errorText?: string
  // For streaming: the ReadableStream of the upstream body.
  body: ReadableStream<Uint8Array> | null
  // For non-streaming: the already-parsed JSON (null if caller wants the stream).
  json?: unknown
}

export interface AnthropicClient {
  // POST https://api.anthropic.com/v1/messages with OAuth Bearer.
  sendMessages(opts: AnthropicFetchOptions): Promise<AnthropicFetchResponse>
  // GET https://models.dev/api.json (used by /v1/models).
  fetchModels(): Promise<unknown>
}
