import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeCliEnv, runCli } from '../helpers/cli-runner'

function plantValidAuth(env: ReturnType<typeof makeCliEnv>): void {
  const dir = join(env.xdgConfigHome, 'cursor-claude')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'auth.json'),
    JSON.stringify({
      'auth:anthropic': {
        type: 'oauth',
        refresh: 'r',
        access: 'a',
        expires: Date.now() + 3_600_000,
      },
    }),
  )
}

describe('cursor-claude login', () => {
  const envs: Array<{ cleanup: () => void }> = []
  afterEach(() => {
    envs.splice(0).forEach((e) => e.cleanup())
  })

  it('with --no-open and an empty pasted code exits with error', async () => {
    const env = makeCliEnv()
    envs.push(env)
    // No stored credentials — CLI prompts for a code; send an empty line.
    const res = await runCli(['login', '--no-open'], {
      homeDir: env.homeDir,
      xdgConfigHome: env.xdgConfigHome,
      input: '\n',
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr + res.stdout).toMatch(/No code provided|Aborting/i)
  })

  it('without --force skips OAuth when a non-expired token already exists', async () => {
    const env = makeCliEnv()
    envs.push(env)
    plantValidAuth(env)
    const res = await runCli(['login', '--no-open'], {
      homeDir: env.homeDir,
      xdgConfigHome: env.xdgConfigHome,
    })
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Already authenticated')
  })

  it('--force still prints the OAuth URL header (does not short-circuit)', async () => {
    const env = makeCliEnv()
    envs.push(env)
    plantValidAuth(env)
    const res = await runCli(['login', '--no-open', '--force'], {
      homeDir: env.homeDir,
      xdgConfigHome: env.xdgConfigHome,
      input: '\n',
    })
    expect(res.stdout).toContain('Claude OAuth login')
    expect(res.stdout).toContain('claude.ai/oauth/authorize')
    expect(res.exitCode).toBe(1)
  })
})
