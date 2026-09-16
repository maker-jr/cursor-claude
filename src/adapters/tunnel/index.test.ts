import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TunnelError } from '../../domain/errors'
import type { TunnelHandle } from '../../ports/tunnel'

vi.mock('./ngrok', () => ({
  isNgrokInstalled: vi.fn(),
  startNgrokTunnel: vi.fn(),
}))
vi.mock('./cloudflared', () => ({
  isCloudflaredInstalled: vi.fn(),
  startCloudflaredTunnel: vi.fn(),
}))

import { isCloudflaredInstalled, startCloudflaredTunnel } from './cloudflared'
import { isNgrokInstalled, startNgrokTunnel } from './ngrok'
import { startTunnel } from './index'

const ngrokHandle: TunnelHandle = {
  publicUrl: 'https://x.ngrok.app',
  provider: 'ngrok',
  stop: async () => {},
}
const cloudflaredHandle: TunnelHandle = {
  publicUrl: 'https://x.trycloudflare.com',
  provider: 'cloudflared',
  stop: async () => {},
}

describe('startTunnel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('auto prefers ngrok when installed', async () => {
    vi.mocked(isNgrokInstalled).mockResolvedValue(true)
    vi.mocked(isCloudflaredInstalled).mockResolvedValue(true)
    vi.mocked(startNgrokTunnel).mockResolvedValue(ngrokHandle)

    const handle = await startTunnel(9095, 'auto')

    expect(handle.provider).toBe('ngrok')
    expect(startCloudflaredTunnel).not.toHaveBeenCalled()
  })

  it('auto falls back to cloudflared when ngrok is not installed', async () => {
    vi.mocked(isNgrokInstalled).mockResolvedValue(false)
    vi.mocked(isCloudflaredInstalled).mockResolvedValue(true)
    vi.mocked(startCloudflaredTunnel).mockResolvedValue(cloudflaredHandle)

    const handle = await startTunnel(9095, 'auto')

    expect(handle.provider).toBe('cloudflared')
    expect(startNgrokTunnel).not.toHaveBeenCalled()
  })

  it('auto falls back to cloudflared when ngrok fails to start', async () => {
    vi.mocked(isNgrokInstalled).mockResolvedValue(true)
    vi.mocked(isCloudflaredInstalled).mockResolvedValue(true)
    vi.mocked(startNgrokTunnel).mockRejectedValue(
      new TunnelError('no authtoken'),
    )
    vi.mocked(startCloudflaredTunnel).mockResolvedValue(cloudflaredHandle)
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    const handle = await startTunnel(9095, 'auto')

    expect(handle.provider).toBe('cloudflared')
    consoleError.mockRestore()
  })

  it('auto rethrows the ngrok error when cloudflared is not installed', async () => {
    vi.mocked(isNgrokInstalled).mockResolvedValue(true)
    vi.mocked(isCloudflaredInstalled).mockResolvedValue(false)
    vi.mocked(startNgrokTunnel).mockRejectedValue(
      new TunnelError('no authtoken'),
    )

    await expect(startTunnel(9095, 'auto')).rejects.toThrow('no authtoken')
  })

  it('auto throws an install hint when no provider is available', async () => {
    vi.mocked(isNgrokInstalled).mockResolvedValue(false)
    vi.mocked(isCloudflaredInstalled).mockResolvedValue(false)

    await expect(startTunnel(9095, 'auto')).rejects.toThrow(
      /No tunnel provider found/,
    )
  })

  it('explicit provider choice is honored without fallback', async () => {
    vi.mocked(startCloudflaredTunnel).mockResolvedValue(cloudflaredHandle)

    const handle = await startTunnel(9095, 'cloudflared')

    expect(handle.provider).toBe('cloudflared')
    expect(isNgrokInstalled).not.toHaveBeenCalled()
  })
})
