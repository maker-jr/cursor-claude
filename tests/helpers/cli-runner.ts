import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'

// The CLI calls `dotenv.config()` with default options, which loads `./.env`
// relative to `process.cwd()`. Tests must run with a cwd that does not contain
// the repo's `.env` (REDIS_URL etc.), or they will hit the wrong credential backend.
export function isolatedCliCwd(): string {
  return mkdtempSync(join(tmpdir(), 'cc-cli-cwd-'))
}

export interface CliEnv {
  homeDir: string
  xdgConfigHome: string
  cleanup: () => void
}

export function makeCliEnv(): CliEnv {
  const base = mkdtempSync(join(tmpdir(), 'cc-cli-'))
  const home = join(base, 'home')
  const xdg = join(home, '.config')
  return {
    homeDir: home,
    xdgConfigHome: xdg,
    cleanup: () => {
      try {
        rmSync(base, { recursive: true, force: true })
      } catch {
        // best-effort
      }
    },
  }
}

export function cliBinPath(): string {
  // Relative to the repo root. Vitest cwd is the repo root.
  return join(process.cwd(), 'bin', 'cursor-claude.js')
}

export async function runCli(
  args: string[],
  opts: {
    env?: Record<string, string>
    homeDir?: string
    xdgConfigHome?: string
    /** Override cwd; default is an empty temp dir (no repo `.env`). */
    cwd?: string
    input?: string
    timeoutMs?: number
  } = {},
) {
  const cwd = opts.cwd ?? isolatedCliCwd()
  const env: Record<string, string> = {
    // Start from a minimal env so we don't pick up REDIS_URL etc from the shell.
    PATH: process.env.PATH ?? '',
    HOME: opts.homeDir ?? process.env.HOME ?? tmpdir(),
    XDG_CONFIG_HOME: opts.xdgConfigHome ?? '',
    ...(opts.env ?? {}),
  }
  // Strip remote-credential env unless the test explicitly sets them.
  for (const key of [
    'REDIS_URL',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ]) {
    if (!(key in (opts.env ?? {}))) {
      delete env[key]
    }
  }

  return await execa(cliBinPath(), args, {
    env,
    input: opts.input,
    reject: false,
    timeout: opts.timeoutMs ?? 10_000,
    cwd,
  })
}

/** Env for `spawn` integration tests: no Redis/Upstash leakage, isolated HOME/XDG. */
export function spawnCliEnv(opts: {
  homeDir: string
  xdgConfigHome: string
  extra?: Record<string, string | undefined>
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH ?? '',
    HOME: opts.homeDir,
    XDG_CONFIG_HOME: opts.xdgConfigHome,
    ...opts.extra,
  }
  delete env.REDIS_URL
  delete env.UPSTASH_REDIS_REST_URL
  delete env.UPSTASH_REDIS_REST_TOKEN
  return env
}
