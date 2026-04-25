import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findFreePort } from '../../src/adapters/tunnel/port'
import { isolatedCliCwd, makeCliEnv, runCli } from '../helpers/cli-runner'

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

function readPid(env: ReturnType<typeof makeCliEnv>): number | null {
  const pidPath = join(env.xdgConfigHome, 'cursor-claude', 'server.pid')
  if (!existsSync(pidPath)) return null
  const n = Number(readFileSync(pidPath, 'utf8').trim())
  return Number.isInteger(n) ? n : null
}

describe('cursor-claude start --detach', () => {
  const envs: Array<{ cleanup: () => void }> = []
  afterEach(() => {
    envs.splice(0).forEach((e) => e.cleanup())
  })

  it('writes a PID file and rejects a second --detach while the child is alive', async () => {
    const env = makeCliEnv()
    envs.push(env)
    plantValidAuth(env)
    const port = (await findFreePort(19700, 40)) ?? 19700
    const cwd = isolatedCliCwd()

    const first = await runCli(
      ['start', '--detach', '-p', String(port), '--no-auto-port'],
      {
        homeDir: env.homeDir,
        xdgConfigHome: env.xdgConfigHome,
        cwd,
      },
    )
    expect(first.exitCode).toBe(0)
    expect(first.stdout).toContain('background')

    const pid = readPid(env)
    expect(pid).not.toBeNull()

    // Use another free port: `runStart` probes the port before the PID guard in
    // `launchDetached`, so a second attempt on the same port fails with "port in use"
    // instead of "already running".
    const secondPort = (await findFreePort(port + 1, 20)) ?? port + 1
    const second = await runCli(
      ['start', '--detach', '-p', String(secondPort), '--no-auto-port'],
      {
        homeDir: env.homeDir,
        xdgConfigHome: env.xdgConfigHome,
        cwd,
      },
    )
    expect(second.exitCode).toBe(1)
    expect(second.stderr + second.stdout).toMatch(/already running|pid/i)

    // Tear down the background server.
    if (pid != null) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // process may have exited
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  }, 20_000)

  it('status reports the detached pid while the child is running', async () => {
    const env = makeCliEnv()
    envs.push(env)
    plantValidAuth(env)
    const port = (await findFreePort(19800, 40)) ?? 19800
    const cwd = isolatedCliCwd()

    const detach = await runCli(
      ['start', '--detach', '-p', String(port), '--no-auto-port'],
      {
        homeDir: env.homeDir,
        xdgConfigHome: env.xdgConfigHome,
        cwd,
      },
    )
    expect(detach.exitCode).toBe(0)
    const pid = readPid(env)
    expect(pid).not.toBeNull()

    const st = await runCli(['status'], {
      homeDir: env.homeDir,
      xdgConfigHome: env.xdgConfigHome,
      cwd,
    })
    expect(st.exitCode).toBe(0)
    expect(st.stdout).toContain(String(pid))

    if (pid != null) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {}
    }
  }, 20_000)
})
