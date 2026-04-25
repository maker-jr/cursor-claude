import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../helpers/cli-runner'

// Local stub server that serves the same fixture the integration tests use,
// so the CLI never touches models.dev.

const fixture = readFileSync(
  join(__dirname, '..', 'fixtures', 'models-dev.json'),
  'utf8',
)

let server: Server
let port: number

beforeEach(async () => {
  server = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(fixture)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as { port: number }).port
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function modelsUrlEnv(): Record<string, string> {
  return {
    CURSOR_CLAUDE_MODELS_URL: `http://127.0.0.1:${port}/api.json`,
  }
}

describe('cursor-claude models', () => {
  it('default output is a human table containing each model id', async () => {
    const res = await runCli(['models'], { env: modelsUrlEnv() })
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Anthropic models available')
    // Spot-check that every model from the fixture appears.
    const parsed = JSON.parse(fixture) as {
      anthropic: { models: Record<string, unknown> }
    }
    for (const id of Object.keys(parsed.anthropic.models)) {
      expect(res.stdout).toContain(id)
    }
    // Footer hint mentions Cursor settings + JSON/ids-only flags.
    expect(res.stdout).toContain('Settings')
    expect(res.stdout).toContain('--json')
    expect(res.stdout).toContain('--ids-only')
  })

  it('--ids-only prints one model id per line, nothing else', async () => {
    const res = await runCli(['models', '--ids-only'], { env: modelsUrlEnv() })
    expect(res.exitCode).toBe(0)
    const lines = res.stdout.trim().split('\n').filter((l) => l.length > 0)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      // Each line should be a bare model id (no whitespace, no formatting).
      expect(line).toMatch(/^[a-z0-9-]+$/)
    }
    // Should NOT contain any of the table decorations.
    expect(res.stdout).not.toContain('Anthropic models available')
    expect(res.stdout).not.toContain('--json')
  })

  it('--json prints a parseable OpenAI-shaped models list', async () => {
    const res = await runCli(['models', '--json'], { env: modelsUrlEnv() })
    expect(res.exitCode).toBe(0)
    const parsed = JSON.parse(res.stdout) as {
      object: string
      data: Array<{
        id: string
        object: string
        created: number
        owned_by: string
      }>
    }
    expect(parsed.object).toBe('list')
    expect(Array.isArray(parsed.data)).toBe(true)
    expect(parsed.data.length).toBeGreaterThan(0)
    for (const m of parsed.data) {
      expect(m.object).toBe('model')
      expect(m.owned_by).toBe('anthropic')
      expect(typeof m.id).toBe('string')
      expect(typeof m.created).toBe('number')
    }
  })

  it('--json wins when both --json and --ids-only are passed', async () => {
    const res = await runCli(['models', '--json', '--ids-only'], {
      env: modelsUrlEnv(),
    })
    expect(res.exitCode).toBe(0)
    // If JSON wins, the output is parseable JSON. If ids-only wins, it isn't.
    expect(() => JSON.parse(res.stdout)).not.toThrow()
  })

  it('exits 1 with a clear message when the upstream is unreachable', async () => {
    // Point at a definitely-closed port (we just closed the test server here
    // in afterEach order; instead, point at port 1 which won't be listening).
    const res = await runCli(['models'], {
      env: { CURSOR_CLAUDE_MODELS_URL: 'http://127.0.0.1:1/api.json' },
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('Failed to fetch model list')
  })
})
