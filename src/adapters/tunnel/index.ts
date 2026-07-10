import type { TunnelChoice, TunnelHandle } from '../../ports/tunnel'
import {
  isCloudflaredInstalled,
  startCloudflaredTunnel,
} from './cloudflared'
import { startNgrokTunnel } from './ngrok'

/**
 * Start a tunnel with the requested provider. 'auto' prefers cloudflared
 * (no account, no one-agent limit, no interstitial page) and falls back to
 * ngrok when cloudflared isn't installed.
 */
export async function startTunnel(
  localPort: number,
  provider: TunnelChoice,
): Promise<TunnelHandle> {
  const resolved =
    provider === 'auto'
      ? (await isCloudflaredInstalled())
        ? 'cloudflared'
        : 'ngrok'
      : provider

  return resolved === 'cloudflared'
    ? startCloudflaredTunnel(localPort)
    : startNgrokTunnel(localPort)
}
