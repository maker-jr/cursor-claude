# Contributing

Thanks for helping improve `cursor-claude`. This document covers the basics for local development and pull requests.

## Prerequisites

- Node.js 18 or newer (see `package.json` `engines`)
- npm (lockfile is `package-lock.json`; use `npm ci` in CI and for clean installs)

## Setup

```bash
git clone https://github.com/maker-jr/cursor-claude.git
cd cursor-claude
npm ci
cp env.example .env   # optional; see README for variables
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript check without emitting files |
| `npm test` | Run the full Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Tests with coverage (thresholds in `vitest.config.ts`) |
| `npm run build` | Compile to `dist/` |
| `npm run cli -- --help` | Run the CLI via `tsx` during development |

## Tests

- **Unit / adapter tests** live next to sources as `*.test.ts` under `src/`.
- **Integration tests** use `app.fetch()` against the Hono app under `tests/integration/`.
- **CLI tests** spawn the built entrypoint with an isolated `cwd` and temp config; run `npm run build` before relying on `bin/cursor-claude.js`.

Keep new tests deterministic: avoid real network calls, use fakes/mocks, and do not depend on a repo-root `.env` for credential-store selection (CLI helpers default to an isolated temp `cwd`).

## Pull requests

- Describe the change and any user-visible behavior.
- Ensure `npm run typecheck`, `npm run test:coverage`, and `npm run build` pass locally.
- Keep diffs focused; match existing style and patterns in nearby files.

## License

By contributing, you agree that your contributions will be licensed under the same terms as the project (MIT). See `LICENSE`.
