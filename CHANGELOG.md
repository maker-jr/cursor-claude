# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
