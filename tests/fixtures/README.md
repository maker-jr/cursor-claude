# Test fixtures

Hand-crafted fixtures matching the Anthropic Messages API wire format. Shapes
are derived from the public Anthropic documentation and from what the live
proxy observes; content is anonymized (no real API keys, tokens, or user data).

- `sse/` — recorded streaming transcripts used by the stream converter tests.
  - `text-reply.sse` — plain text assistant reply.
  - `tool-use.sse` — single tool call with streaming JSON arguments.
  - `multi-block.sse` — text block followed by a tool call (multi-content-block response).
- `anthropic-response/` — non-streaming JSON response fixtures used by
  `convertNonStreamingResponse` tests.
- `models-dev.json` — frozen snapshot of `models.dev/api.json` shape used by
  the `/v1/models` route.

These files are fully deterministic and check in cleanly. If the upstream wire
format drifts, re-record from a live session and paste over these files.
