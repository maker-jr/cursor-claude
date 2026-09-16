import pc from 'picocolors'
import { TunnelError } from '../../domain/errors'
import type { TunnelChoice, TunnelHandle } from '../../ports/tunnel'
import {
  isCloudflaredInstalled,
  startCloudflaredTunnel,
} from './cloudflared'
import { isNgrokInstalled, startNgrokTunnel } from './ngrok'

/**
 * Start a tunnel with the requested provider. 'auto' prefers ngrok: its edge
 * holds long-lived SSE connections reliably, while Cloudflare quick tunnels
 * (trycloudflare.com) are best-effort and routinely drop or stall long
 * streams. cloudflared is the fallback when ngrok isn't installed or fails
 * to start (e.g. missing authtoken, free-tier one-agent limit).
 */
export async function startTunnel(
  localPort: number,
  provider: TunnelChoice,
): Promise<TunnelHandle> {
  if (provider === 'cloudflared') return startCloudflaredTunnel(localPort)
  if (provider === 'ngrok') return startNgrokTunnel(localPort)

  const [hasNgrok, hasCloudflared] = await Promise.all([
    isNgrokInstalled(),
    isCloudflaredInstalled(),
  ])

  if (hasNgrok) {
    try {
      return await startNgrokTunnel(localPort)
    } catch (err) {
      if (!hasCloudflared) throw err
      const firstLine = (err as Error).message.split('\n')[0]
      console.error(
        pc.yellow('!') +
          ` ngrok failed (${firstLine}) — falling back to cloudflared.`,
      )
      return startCloudflaredTunnel(localPort)
    }
  }
  if (hasCloudflared) return startCloudflaredTunnel(localPort)

  throw new TunnelError(
    'No tunnel provider found. Install one of:\n' +
      '  ngrok (recommended):  brew install ngrok/ngrok/ngrok\n' +
      '                        then: ngrok config add-authtoken <your-token>\n' +
      '  cloudflared:          brew install cloudflared',
  )
}
