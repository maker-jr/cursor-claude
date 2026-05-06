# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
