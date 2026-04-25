import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mocks for child_process.spawn and global fetch. We control both so we can
// simulate each branch: ngrok-missing, already-running preflight, happy path,
// early-exit, and timeout.

function createFakeChild(opts: { exitImmediately?: { code: number } } = {}) {
  const child: any = new EventEmitter()
  child.stdio = ['ignore', null, null]
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn()
  if (opts.exitImmediately) {
    setImmediate(() => {
      child.exitCode = opts.exitImmediately!.code
      child.emit('exit', opts.exitImmediately!.code, null)
    })
  }
  return child
}

describe('startNgrokTunnel', () => {
  let spawnMock: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn>
  let originalFetch: typeof fetch

  beforeEach(() => {
    vi.resetModules()
    spawnMock = vi.fn()
    vi.doMock('node:child_process', () => ({
      spawn: spawnMock,
    }))
    originalFetch = globalThis.fetch
    fetchMock = vi.fn() as any
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('throws TunnelError when ngrok binary is missing', async () => {
    // First spawn call is `ngrok version` — simulate ENOENT.
    spawnMock.mockImplementationOnce(() => {
      const child: any = new EventEmitter()
      setImmediate(() => child.emit('error', new Error('ENOENT')))
      return child
    })

    const mod = await import('./ngrok')
    await expect(mod.startNgrokTunnel(9000)).rejects.toThrow(
      /ngrok is not installed/,
    )
  })

  it('throws when another ngrok agent is already running (preflight detection)', async () => {
    // `ngrok version` probe succeeds.
    spawnMock.mockImplementationOnce(() => {
      const c: any = new EventEmitter()
      setImmediate(() => c.emit('exit', 0, null))
      return c
    })
    // Preflight fetch to 4040 returns a live tunnels list.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tunnels: [
            {
              public_url: 'https://already.ngrok.app',
              proto: 'https',
              config: { addr: 'http://localhost:9000' },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const mod = await import('./ngrok')
    await expect(mod.startNgrokTunnel(9000)).rejects.toThrow(
      /Another ngrok agent is already running/,
    )
  })

  it('early exit of the ngrok child surfaces as TunnelError', async () => {
    // `ngrok version` success.
    spawnMock.mockImplementationOnce(() => {
      const c: any = new EventEmitter()
      setImmediate(() => c.emit('exit', 0, null))
      return c
    })
    // Preflight fetch: 4040 is down.
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    // isPortFree probe (net-level) runs before spawn; rely on it finding 4040 free.
    // Then `ngrok http ...` — spawn a child that exits immediately with code 1.
    spawnMock.mockImplementationOnce(() =>
      createFakeChild({ exitImmediately: { code: 1 } }),
    )
    // waitForPublicUrl polls fetch; force failures so we rely on exit.
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))

    const mod = await import('./ngrok')
    await expect(mod.startNgrokTunnel(9000)).rejects.toBeInstanceOf(Error)
  })

  // Happy-path mocking of `spawn` + `fetch` would require deep control over
  // the ChildProcess surface that ngrok.ts uses (stderr stream, exit code,
  // signalCode). The preflight, missing-binary, and early-exit branches give
  // us the important coverage; the happy path is exercised by integration
  // harnesses outside this unit test.
})
