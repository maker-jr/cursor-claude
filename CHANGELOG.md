# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2] - 2026-09-16

### Fixed

- **Claude 5 family models work** (`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5-1`, ...). Three independent 4xx sources fixed:
  - The model-name catalog didn't know the Claude 5 ids, so suffixed names like `claude-opus-5-thinking-high` were forwarded verbatim and Anthropic returned `404 not_found_error`. The static fallback catalog now includes the Claude 5 family (and `claude-opus-4-8`), and — so this never recurs on day one of a future model — an uncataloged `claude-*` name now gets its recognized metadata tokens (`thinking`, effort levels) stripped off the tail even when no catalog lists it.
  - Thinking suffixes on 4.7+ / Claude 5 models would have injected `thinking: {type: "enabled", budget_tokens: N}`, which those models reject with a 400 (`budget_tokens` was removed). The generation logic is inverted: only the 4.5-and-older generation gets `budget_tokens`; everything newer or unknown gets `thinking: {type: "adaptive"}`. `output_config.effort` is likewise no longer sent to the legacy generation, which rejects it.
  - `temperature`/`top_p`/`top_k` (Cursor sends `temperature` by default) are stripped for Opus 4.7+ and the Claude 5 family, where sampling params were removed and return a 400.
- The inverted word-order normalizer now recognizes the `fable` family name.

[1.4.2]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.4.2

## [1.4.1] - 2026-09-16

### Fixed

- **A client-side connection reset no longer kills the proxy.** When the tunnel edge or Cursor's backend drops its socket mid-request (e.g. a brief network blip), Node raises `Error: aborted` / `ECONNRESET` asynchronously with no request context to handle it on — an uncaught exception that took down the whole server, killing every other in-flight stream with it. The proxy now recognizes these disconnect errors (`ECONNRESET`, `EPIPE`, `ERR_STREAM_PREMATURE_CLOSE`, `aborted`), logs a one-line warning, and keeps serving; the dropped request itself is simply retried by the client. Any other uncaught error still crashes loudly as before.

[1.4.1]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.4.1

## [1.4.0] - 2026-09-16

### Changed

- **ngrok is now the default tunnel provider.** Bare `--tunnel` prefers ngrok when installed and falls back to cloudflared (missing binary *or* a failed ngrok start, e.g. no authtoken or the free-tier one-agent limit). Cloudflare quick tunnels (`*.trycloudflare.com`) are best-effort infrastructure with no SLA and were the main source of dropped long-lived streams; ngrok's edge holds streaming connections reliably. `--tunnel cloudflared` still forces cloudflared.

### Fixed

- **Streams no longer drop during long silent stretches.** Anthropic's SSE `ping` events are consumed by the OpenAI conversion, so during extended thinking or long tool-argument generation the client-facing stream went completely silent — and tunnels/Cursor's backend killed the "idle" connection. The proxy now emits an SSE comment heartbeat (`: keepalive`) after 15s without output (only at SSE frame boundaries, so passthrough streams can't be corrupted).
- **Streaming responses now send explicit anti-buffering headers** (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`), telling tunnels and reverse proxies not to buffer or compress the stream.
- **Keep-alive connection resets behind tunnels.** Node's HTTP server closes idle keep-alive connections after 5s by default; the tunnel agent pools and reuses connections, so every race lost to that timer surfaced as a reset — random slow or failed requests at the edge. `keepAliveTimeout` is now 120s (with `headersTimeout` at 125s).
- **Long streams no longer die at 5 minutes.** Node's default `requestTimeout` (300s) could tear down the socket mid-stream; it is now disabled for this single-user proxy.
- **Faster connections on Node 18 with broken IPv6.** Happy-eyeballs (`net.setDefaultAutoSelectFamily(true)`) is enabled when available, so dual-stack connections to `api.anthropic.com` race IPv6/IPv4 instead of stalling on a dead IPv6 path.

[1.4.0]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.4.0

## [1.3.0] - 2026-07-10

### Added

- **cloudflared tunnel support**: `--tunnel` now accepts a provider (`--tunnel cloudflared` / `--tunnel ngrok`). Bare `--tunnel` auto-selects cloudflared when installed (no account, no authtoken, no one-tunnel limit, no interstitial page) and falls back to ngrok. The cloudflared adapter waits for the tunnel's edge registration *and* for the `*.trycloudflare.com` hostname to actually resolve (checked via DNS-over-HTTPS) before reporting the URL — quick-tunnel DNS records take a few seconds to propagate and NXDOMAIN is negatively cached for 30 minutes, so a premature lookup used to break the tunnel for half an hour.

### Fixed

- **Chat requests no longer block on models.dev.** The model-catalog refresh is now stale-while-revalidate with single-flight and a 60s negative cache, and the fetch itself has a 3s timeout. Previously every cache expiry (5 min) and every cold start awaited an untimed fetch to models.dev on the request path — a slow or hung models.dev stalled chats for minutes.
- **Upstream deadlines and retries.** The Anthropic request now has a 30s response-headers timeout, streaming reads have a 90s idle watchdog, and transient failures (network errors, 408/429/5xx/529) are retried up to twice with backoff before any bytes reach the client.
- **Stale `content-length` no longer forwarded on non-streaming responses.** The proxy re-serializes a transformed body, so copying the upstream `content-length`/`transfer-encoding` headers could make clients hang waiting for bytes that never arrive.
- **Client disconnects propagate upstream.** Cancelling a request in the IDE now aborts the upstream Anthropic call instead of leaving it streaming into the void (burning rate limit and stacking connections on retries).
- **Single-flight OAuth refresh with a 30s pre-expiry buffer.** Concurrent requests at token expiry previously raced `refreshToken`; since Anthropic rotates refresh tokens, the losers could invalidate the stored credentials and force a manual re-login. Tokens are also cached in memory now, removing the credential-store round-trip (an HTTPS call on Upstash, a disk read locally) from every request.
- **Mid-stream failures are surfaced to the client** as an error SSE event plus `[DONE]` instead of a silent connection close that IDEs render as an endless spinner.

[1.3.0]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.3.0

## [1.2.2] - 2026-07-08

### Fixed

- Fixed silent content loss during streaming responses when a network read split a `data: {...}` SSE line mid-JSON (not on a newline boundary). This is common on longer responses and over tunneled connections (e.g. ngrok), and previously caused text or tool-call arguments to vanish from the response with no error surfaced anywhere — the stream would just appear to slow down and drop content. `processChunk` now buffers an incomplete trailing line across calls (`ConverterState.pendingLine`) instead of parsing partial JSON and silently discarding the parse failure. A new `flushPendingLine()` is invoked when the upstream stream ends to catch a final line that never received a trailing newline.

[1.2.2]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.2.2

## [1.2.1] - 2026-05-07

### Fixed

- Model names with dots as version separators (e.g. `claude-sonnet-4.6-medium`) are now normalised to hyphens before catalog matching so they resolve correctly.
- Model names with the version segment before the family name (e.g. `claude-4.6-sonnet-medium`, `claude-4-6-sonnet-medium`) are now reordered to canonical form (`claude-sonnet-4-6-medium`) before catalog matching. Classic single-digit names like `claude-3-opus` are left untouched.

[1.2.1]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.2.1

## [1.2.0] - 2026-05-06

### Added

- **Cursor model-name suffix support**: the proxy now recognises Cursor-style model name suffixes (`-thinking`, `-thinking-<effort>`, `-<effort>`) and maps them to the correct Anthropic API parameters before forwarding. Cursor 4.6+ blocks adding bare `claude-*` ids via a custom base URL; users register variant names (e.g. `claude-sonnet-4-6-thinking-xhigh`) and the proxy translates them transparently:
  - `thinking` suffix → `thinking: { type: 'adaptive' }` for 4.6/4.7 models; `thinking: { type: 'enabled', budget_tokens: N }` for older models.
  - Effort suffix (`low`, `medium`, `high`, `xhigh`, `max`) → `output_config.effort`.
  - Unknown suffix tokens are stripped with a warning log rather than causing a 400 error.
- `src/domain/proxy/model-name.ts` — pure `parseModelName` helper with longest-prefix match against the live model catalog (5-minute cache) and a committed static fallback list.
- `src/domain/proxy/extended-thinking.ts` — pure `applyThinkingAndEffort` helper encapsulating the 4.6/4.7-vs-older generation matrix.
- README FAQ section: "Cursor blocks `claude-*` names — use suffixes instead" with a quick-reference table.

### Fixed

- Requests from Cursor using thinking/effort model variants no longer receive a 400 error from Anthropic.

[1.2.0]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.2.0

## [1.1.0] - 2026-04-25

### Added

- New `cursor-claude models` command lists the Anthropic models you can plug into Cursor (or any OpenAI-compatible client). Three output modes:
  - default — human-readable table with model id, name, and release date
  - `--json` — OpenAI-shaped models payload, ideal for piping to `jq`
  - `--ids-only` — one model id per line, ideal for shell pipes
- The `start` banner now hints at the new command so users discover it without reading docs.

### Changed

- Extracted models.dev shaping into a pure domain helper (`src/domain/proxy/models.ts`) shared by the HTTP route and the new CLI command. No behavior change for existing `/v1/models` consumers.
- `CURSOR_CLAUDE_MODELS_URL` env var now overrides the upstream models.dev URL — used by the test suite to avoid touching the real network. End users normally never set it.

[1.1.0]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.1.0

## [1.0.1] - 2026-04-25

### Fixed

- `cursor-claude start --tunnel` now works on ngrok 3.x. The previous build passed `--web-addr`, `--log-format`, and `--log-level` as CLI flags; ngrok 3 only accepts `--web-addr` via the `NGROK_WEB_ADDR` env var (or its YAML config), and the `--log-format`/`--log-level` flags are silently ignored when `--log` is not set. The CLI now uses the env var only when port 4040 is busy, and otherwise stays out of ngrok's way.

[1.0.1]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.0.1

## [1.0.0] - 2026-04-24

### Added

- Initial npm-packaged release as `cursor-claude`: CLI (`login`, `start`, `status`, `logout`), local OpenAI-compatible proxy, OAuth to Anthropic, optional ngrok tunnel, file or Redis/Upstash credential storage.
- Vitest suite (unit, integration, CLI), GitHub Actions CI, and contributor documentation.

### Changed

- Project layout refactored toward hexagonal architecture (`src/domain`, `src/ports`, `src/adapters`, `src/http`) with Hono routes and injected dependencies.

### Credits

- Based on the earlier [Maol-1997/cursor-claude-connector](https://github.com/Maol-1997/cursor-claude-connector); not a GitHub fork. See README Credits.

[1.0.0]: https://github.com/maker-jr/cursor-claude/releases/tag/v1.0.0
