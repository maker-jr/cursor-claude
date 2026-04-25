# Architecture

`cursor-claude` is structured as a small **hexagonal** (ports and adapters) TypeScript service plus a CLI.

## Layers

| Layer | Path | Role |
| --- | --- | --- |
| **Domain** | `src/domain/` | Pure logic: OAuth helpers, token lifecycle, request/response transforms, streaming conversion, policies. No Node I/O. |
| **Ports** | `src/ports/` | Interfaces: credential store, config store, Anthropic/OAuth HTTP clients, tunnel, clock, logger. |
| **Adapters** | `src/adapters/` | Implementations: file/Redis/Upstash storage, `fetch`-based Anthropic and OAuth clients, ngrok + port helpers, console logger, system clock. |
| **HTTP** | `src/http/` | Hono app: routes (`/`, `/v1/models`, `/v1/chat/completions`, `/v1/messages`, `/auth/*`), middleware (CORS, API key, request logging). Composed with injected dependencies. |
| **CLI** | `src/cli/` | Commander commands (`login`, `start`, `status`, `logout`) that build real adapters via `composition.ts` and call domain/use-case code. |

Legacy paths under `src/auth/`, `src/storage/`, and `src/utils/` still exist for compatibility with older entrypoints; new work should prefer `domain` + `adapters` + `http`.

## Request flow

1. Client sends an OpenAI-compatible request to the proxy with the configured API key.
2. Middleware validates the key and logs the request.
3. Route handlers translate the body and headers to Anthropic Messages API shape (`domain/proxy`).
4. The Anthropic adapter calls Anthropic with OAuth bearer tokens from the credential store.
5. Streaming or non-streaming responses are converted back to OpenAI-style SSE or JSON.

## Configuration and secrets

- **File-backed** (default): `~/.config/cursor-claude/` (or `XDG_CONFIG_HOME` + `cursor-claude/`) for `auth.json` and `config.json`.
- **Redis / Upstash**: when `REDIS_URL` or Upstash REST env vars are set, credentials are stored remotely (typical for Vercel-style deploys).
- **`dotenv`**: the CLI loads `.env` from the **current working directory** only; a repo-level `.env` with `REDIS_URL` will switch storage for any command run from that directory.

## Testing

- Unit tests colocated as `*.test.ts` under `src/`.
- Integration tests call `createApp(deps).fetch()` in-process under `tests/integration/`.
- CLI tests spawn `node bin/cursor-claude.js` with an isolated temp `cwd` and temp `HOME` / `XDG_CONFIG_HOME` so local `.env` does not affect behavior.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for commands and conventions.
