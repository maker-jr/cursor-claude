import { spawn } from 'node:child_process'
import { TunnelError } from '../../domain/errors'
import type { TunnelHandle } from '../../ports/tunnel'
import { binaryWorks, sleep, stopChild } from './process-utils'

const PUBLIC_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/
// cloudflared prints the public URL BEFORE it actually connects to the edge.
// Requests made in that window fail DNS and can poison local negative caches,
// so readiness requires this line too.
const REGISTERED_RE = /Registered tunnel connection/

/**
 * Start a Cloudflare quick tunnel (trycloudflare.com) to the given local
 * port. Requires the `cloudflared` binary on PATH. No account or authtoken
 * needed, no concurrent-agent limit, and no interstitial page — which makes
 * it both faster and less restricted than free-tier ngrok.
 *
 * The public URL is parsed from cloudflared's log output (it prints the
 * assigned trycloudflare.com URL on startup).
 */
export async function startCloudflaredTunnel(
  localPort: number,
): Promise<TunnelHandle> {
  if (!(await isCloudflaredInstalled())) {
    throw new TunnelError(
      'cloudflared is not installed or not on PATH.\n' +
        '  Install it with:  brew install cloudflared\n' +
        '  Or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    )
  }

  const child = spawn(
    'cloudflared',
    [
      'tunnel',
      '--url',
      `http://127.0.0.1:${localPort}`,
      '--no-autoupdate',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  try {
    const publicUrl = await waitForPublicUrl(child)
    await waitForDns(new URL(publicUrl).hostname)
    return {
      publicUrl,
      provider: 'cloudflared',
      stop: () => stopChild(child),
    }
  } catch (err) {
    await stopChild(child).catch(() => {})
    throw err
  }
}

// Quick-tunnel hostnames take a few seconds to appear in DNS after the tunnel
// registers, and trycloudflare.com serves NXDOMAIN with a 30-MINUTE negative
// TTL — one premature lookup poisons the resolver for half an hour. Poll via
// DNS-over-HTTPS (bypasses every resolver cache) and only hand out the URL
// once the record exists.
async function waitForDns(hostname: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`,
        {
          headers: { accept: 'application/dns-json' },
          signal: AbortSignal.timeout(3_000),
        },
      )
      if (res.ok) {
        const body = (await res.json()) as { Answer?: unknown[] }
        if (body.Answer && body.Answer.length > 0) return
      }
    } catch {
      // DoH hiccup; keep polling.
    }
    await sleep(1_000)
  }
  // Fall through instead of failing: the record usually lands moments later,
  // and human-timescale use (pasting the URL into Cursor) will be fine.
}

export function isCloudflaredInstalled(): Promise<boolean> {
  return binaryWorks('cloudflared', ['--version'])
}

function waitForPublicUrl(
  child: ReturnType<typeof spawn>,
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false

    const timer = setTimeout(() => {
      finish(
        new TunnelError(
          `Timed out waiting for cloudflared to expose a public URL after ${timeoutMs}ms.\n\ncloudflared output:\n${output.trim()}`,
        ),
      )
    }, timeoutMs)

    const finish = (err: Error | null, url?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(url as string)
    }

    // cloudflared logs to stderr by default; scan both to be safe.
    const onData = (chunk: unknown) => {
      output += String(chunk)
      const match = output.match(PUBLIC_URL_RE)
      if (match && REGISTERED_RE.test(output)) finish(null, match[0])
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.once('exit', (code) => {
      finish(
        new TunnelError(
          `cloudflared exited before exposing a tunnel (code ${code}).\n\ncloudflared output:\n${output.trim()}`,
        ),
      )
    })
    child.once('error', (err) => {
      finish(new TunnelError(`Failed to spawn cloudflared: ${err.message}`))
    })
  })
}

export { TunnelError }
