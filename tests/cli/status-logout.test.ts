import { describe, expect, it, afterEach } from 'vitest'
import { makeCliEnv, runCli } from '../helpers/cli-runner'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

describe('cursor-claude status / logout', () => {
  const envs: Array<{ cleanup: () => void }> = []
  afterEach(() => {
    envs.splice(0).forEach((e) => e.cleanup())
  })

  it('status with no credentials reports "not authenticated"', async () => {
    const env = makeCliEnv()
    envs.push(env)
    const res = await runCli(['status'], {
      homeDir: env.homeDir,
      xdgConfigHome: env.xdgConfigHome,
    })
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('not authenticated')
  })

  it('status with a planted valid auth file reports "authenticated"', async () => {
    const env = makeCliEnv()
    envs.push(env)
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
    const res = await runCli(['status'], {
      homeDir: env.homeDir,
      xdgConfigHome: env.xdgConfigHome,
    })
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('authenticated')
    expect(res.stdout).not.toContain('not authenticated')
  })

  it('logout removes the stored auth file', async () => {
    const env = makeCliEnv()
    envs.push(env)
    const dir = join(env.xdgConfigHome, 'cursor-claude')
    mkdirSync(dir, { recursive: true })
    const authPath = join(dir, 'auth.json')
    writeFileSync(
      authPath,
      JSON.stringify({
        'auth:anthropic': {
          type: 'oauth',
          refresh: 'r',
          access: 'a',
          expires: Date.now() + 3_600_000,
        },
      }),
    )
    const res = await runCli(['logout'], {
      homeDir: env.homeDir,
      xdgConfigHome: env.xdgConfigHome,
    })
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Removed')
    // File remains but should no longer contain the credentials.
    if (existsSync(authPath)) {
      const parsed = JSON.parse(require('node:fs').readFileSync(authPath, 'utf8'))
      expect(parsed['auth:anthropic']).toBeUndefined()
    }
  })
})
