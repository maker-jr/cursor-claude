import { describe, expect, it } from 'vitest'
import { runCli } from '../helpers/cli-runner'

describe('cursor-claude --help / --version', () => {
  it('prints the version number with --version', async () => {
    const res = await runCli(['--version'])
    expect(res.exitCode).toBe(0)
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('prints the root help text with --help', async () => {
    const res = await runCli(['--help'])
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('cursor-claude')
    for (const cmd of ['login', 'start', 'status', 'logout']) {
      expect(res.stdout).toContain(cmd)
    }
  })

  it.each(['login', 'start', 'status', 'logout'])(
    'prints per-command help: %s --help',
    async (cmd) => {
      const res = await runCli([cmd, '--help'])
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain(cmd)
    },
  )
})
