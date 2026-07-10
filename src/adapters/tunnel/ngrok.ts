import { ChildProcess, spawn } from 'node:child_process'
import { TunnelError } from '../../domain/errors'
import type { TunnelHandle } from '../../ports/tunnel'
import { binaryWorks, sleep, stopChild } from './process-utils'
import { findFreePort, isPortFree } from './port'

interface NgrokTunnelsResponse {
  tunnels: Array<{
    public_url: string
    proto: string
    config?: { addr?: string }
  }>
}

/**
 * Start an ngrok HTTPS tunnel to the given local port. Requires the `ngrok`
 * binary on PATH. Reads the public URL from ngrok's local web API (default
 * port 4040) rather than parsing stdout.
 */
export async function startNgrokTunnel(
  localPort: number,
): Promise<TunnelHandle> {
  await ensureNgrokInstalled()

  // Preflight: ngrok's free tier allows only one active agent per authtoken.
  const existing = await detectRunningNgrok()
  if (existing) {
    throw new TunnelError(
      'Another ngrok agent is already running on this machine.\n' +
        '  The free plan allows only one tunnel at a time.\n' +
        existing.summary +
        '\n  Options:\n' +
        '    - Stop the other ngrok (kill it) and retry with --tunnel\n' +
        '    - Or reuse the existing tunnel: point Cursor at ' +
        (existing.firstHttpsUrl
          ? existing.firstHttpsUrl + '/v1'
          : 'the existing public URL') +
        ' and run cursor-claude without --tunnel on the same local port.',
    )
  }

  // ngrok 3.x does NOT accept --web-addr as a CLI flag (it's config-file or
  // env-var only). We default to 4040 (ngrok's own default); if it's busy we
  // pick an alternative and pass it via NGROK_WEB_ADDR.
  const apiPort = (await isPortFree(4040))
    ? 4040
    : (await findFreePort(4041, 20)) ?? 4041

  const env =
    apiPort === 4040
      ? process.env
      : { ...process.env, NGROK_WEB_ADDR: `127.0.0.1:${apiPort}` }

  const child = spawn('ngrok', ['http', String(localPort), '--log=stderr'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })

  let earlyExitErr: string | null = null
  child.on('exit', (code, signal) => {
    if (code !== 0 && !signal) {
      earlyExitErr = `ngrok exited with code ${code}`
    }
  })

  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })

  try {
    const publicUrl = await waitForPublicUrl(apiPort, child, () => earlyExitErr)
    return {
      publicUrl,
      provider: 'ngrok',
      stop: () => stopChild(child),
    }
  } catch (err) {
    await stopChild(child).catch(() => {})
    if (stderr.length > 0) {
      throw new TunnelError(
        `${(err as Error).message}\n\nngrok stderr:\n${stderr.trim()}`,
      )
    }
    throw err
  }
}

interface ExistingNgrok {
  firstHttpsUrl: string | null
  summary: string
}

async function detectRunningNgrok(): Promise<ExistingNgrok | null> {
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels', {
      signal: AbortSignal.timeout(500),
    })
    if (!res.ok) return null
    const body = (await res.json()) as NgrokTunnelsResponse
    const lines = body.tunnels.map((t) => {
      const addr = t.config?.addr ? ` → ${t.config.addr}` : ''
      return `    ${t.public_url} (${t.proto})${addr}`
    })
    const firstHttps = body.tunnels.find((t) => t.proto === 'https')
    return {
      firstHttpsUrl: firstHttps?.public_url ?? null,
      summary: lines.length > 0 ? `  Active tunnels:\n${lines.join('\n')}` : '',
    }
  } catch {
    return null
  }
}

async function ensureNgrokInstalled(): Promise<void> {
  if (!(await binaryWorks('ngrok', ['version']))) {
    throw new TunnelError(
      'ngrok is not installed or not on PATH.\n' +
        '  Install it with:  brew install ngrok/ngrok/ngrok\n' +
        '  Or download from: https://ngrok.com/download\n' +
        '  Then run:         ngrok config add-authtoken <your-token>',
    )
  }
}

async function waitForPublicUrl(
  apiPort: number,
  child: ChildProcess,
  getEarlyExitErr: () => string | null,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  const url = `http://127.0.0.1:${apiPort}/api/tunnels`

  while (Date.now() < deadline) {
    const exitErr = getEarlyExitErr()
    if (exitErr) throw new TunnelError(exitErr)
    if (child.exitCode != null) {
      throw new TunnelError(
        `ngrok exited before exposing a tunnel (code ${child.exitCode})`,
      )
    }

    try {
      const res = await fetch(url)
      if (res.ok) {
        const body = (await res.json()) as NgrokTunnelsResponse
        const https = body.tunnels.find(
          (t) => t.proto === 'https' && typeof t.public_url === 'string',
        )
        if (https) return https.public_url
      }
    } catch {
      // ngrok API isn't up yet; keep polling.
    }

    await sleep(250)
  }

  throw new TunnelError(
    `Timed out waiting for ngrok to expose a public HTTPS URL after ${timeoutMs}ms.`,
  )
}

export { TunnelError }
