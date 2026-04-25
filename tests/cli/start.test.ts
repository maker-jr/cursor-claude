import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findFreePort } from '../../src/adapters/tunnel/port'
import {
  cliBinPath,
  isolatedCliCwd,
  makeCliEnv,
  spawnCliEnv,
} from '../helpers/cli-runner'

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

describe('cursor-claude start (foreground)', () => {
  const envs: Array<{ cleanup: () => void }> = []
  afterEach(() => {
    envs.splice(0).forEach((e) => e.cleanup())
  })

  it('prints the running banner with an API key and shuts down on SIGTERM', async () => {
    const env = makeCliEnv()
    envs.push(env)
    plantValidAuth(env)
    const port = (await findFreePort(19600, 40)) ?? 19600
    const cwd = isolatedCliCwd()
    const child = spawn(process.execPath, [cliBinPath(), 'start', '-p', String(port)], {
      env: spawnCliEnv({
        homeDir: env.homeDir,
        xdgConfigHome: env.xdgConfigHome,
      }),
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let out = ''
    const onData = (chunk: Buffer) => {
      out += chunk.toString()
      if (out.includes('is running') && out.includes('API key')) {
        child.kill('SIGTERM')
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    const exitPromise = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('start did not become ready in time')), 12_000),
    )
    const [code, signal] = await Promise.race([exitPromise, timeout])
    // Foreground `start` is stopped with SIGTERM; Node reports null code + signal in that case.
    expect(code === 0 || (code === null && signal === 'SIGTERM')).toBe(true)
    expect(out).toContain('cursor-claude')
    expect(out).toContain('API key')
    expect(out).toMatch(/cck_|API key:\s+\S+/)
  }, 15_000)
})
