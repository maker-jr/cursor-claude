import { spawn } from 'node:child_process'
import { promises as fs, openSync } from 'node:fs'
import { dirname } from 'node:path'
import pc from 'picocolors'
import { TunnelError } from '../../domain/errors'
import { resolveApiKey } from '../../domain/config/api-key'
import type { ResolvedApiKey } from '../../domain/config/api-key'
import { decideTokenAction } from '../../domain/auth/token-lifecycle'
import {
  getLogFilePath,
  getPidFilePath,
} from '../../adapters/storage/paths'
import { findFreePort, isPortFree } from '../../adapters/tunnel/port'
import type { Deps } from '../../ports'
import type { TunnelHandle } from '../../ports/tunnel'
import { getStorageKind } from '../composition'

const AUTH_KEY = 'auth:anthropic'
const DEFAULT_PORT = 9095

export interface StartOptions {
  port?: number
  autoPort: boolean
  detach: boolean
  tunnel: boolean
  apiKey?: string
}

export async function runStart(
  deps: Deps,
  opts: StartOptions,
): Promise<void> {
  const auth = await deps.credentialStore.get(AUTH_KEY)
  const decision = decideTokenAction(auth, deps.clock.now())
  if (decision.kind === 'missing') {
    console.error(pc.red('✗') + ' Not authenticated.')
    console.error('  Run ' + pc.bold('cursor-claude login') + ' first.')
    process.exitCode = 1
    return
  }

  const envPort = parseEnvPort(process.env.PORT)
  const requested = opts.port ?? envPort ?? DEFAULT_PORT
  const port = await resolvePort(requested, opts.autoPort)
  if (port == null) {
    console.error(
      pc.red('✗') +
        ` Port ${requested} is in use${
          opts.autoPort ? ' and no free port was found nearby' : ''
        }.`,
    )
    console.error(
      '  Try ' + pc.bold(`cursor-claude start --port <other>`) + '.',
    )
    process.exitCode = 1
    return
  }

  const apiKey = await resolveApiKey({
    flag: opts.apiKey,
    envValue: process.env.API_KEY,
    configStore: deps.configStore,
  })
  process.env.API_KEY = apiKey.value

  if (opts.detach) {
    await launchDetached(port, apiKey, opts.tunnel)
    return
  }

  await runInForeground(deps, port, apiKey, opts.tunnel)
}

function parseEnvPort(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : undefined
}

async function resolvePort(
  requested: number,
  autoPort: boolean,
): Promise<number | null> {
  if (await isPortFree(requested)) return requested
  if (!autoPort) return null
  return findFreePort(requested + 1, 10)
}

async function runInForeground(
  deps: Deps,
  port: number,
  apiKey: ResolvedApiKey,
  useTunnel: boolean,
): Promise<void> {
  process.env.PORT = String(port)

  // Lazy-load so `--help` / `login` don't pay for the Hono/server bootstrap.
  const { serve } = await import('@hono/node-server')
  const { createApp } = await import('../../http/app')

  const app = createApp({
    anthropic: deps.anthropic,
    oauth: deps.oauth,
    credentialStore: deps.credentialStore,
    clock: deps.clock,
    logger: deps.logger,
    getExpectedApiKey: () => process.env.API_KEY,
  })

  const server = serve({ fetch: app.fetch, port }, async () => {
    let tunnel: TunnelHandle | null = null
    if (useTunnel) {
      tunnel = await tryStartTunnel(deps, port)
    }
    printBanner(port, apiKey, tunnel?.publicUrl ?? null)

    const shutdown = () => {
      if (tunnel) {
        tunnel.stop().catch(() => {})
      }
      server.close(() => process.exit(0))
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        pc.red('✗') +
          ` Port ${port} is in use (something else grabbed it between probe and bind).`,
      )
    } else {
      console.error(err)
    }
    process.exit(1)
  })
}

async function tryStartTunnel(
  deps: Deps,
  port: number,
): Promise<TunnelHandle | null> {
  console.log(pc.dim('Starting ngrok tunnel...'))
  try {
    return await deps.makeTunnel(port)
  } catch (err) {
    if (err instanceof TunnelError) {
      console.error()
      console.error(pc.red('✗ Failed to start ngrok tunnel:'))
      console.error(indent(err.message, '  '))
      console.error()
      console.error(
        pc.dim('  The proxy is still running locally on ') +
          pc.cyan(`http://localhost:${port}`) +
          pc.dim('.'),
      )
    } else {
      console.error(pc.red('✗ Unexpected tunnel error:'), err)
    }
    return null
  }
}

async function launchDetached(
  port: number,
  apiKey: ResolvedApiKey,
  useTunnel: boolean,
): Promise<void> {
  const logPath = getLogFilePath()
  const pidPath = getPidFilePath()
  await fs.mkdir(dirname(logPath), { recursive: true, mode: 0o700 })

  const existingPid = await readPid()
  if (existingPid != null && isProcessAlive(existingPid)) {
    console.error(
      pc.yellow('!') +
        ` A cursor-claude server is already running (pid ${existingPid}).`,
    )
    console.error(
      '  Run ' + pc.bold('cursor-claude status') + ' for details.',
    )
    process.exitCode = 1
    return
  }

  const logFd = openSync(logPath, 'a')

  // Respawn the same bin minus --detach so the child runs foreground mode.
  const args = process.argv
    .slice(2)
    .filter((a) => a !== '-d' && a !== '--detach')

  const child = spawn(process.execPath, [process.argv[1], ...args], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PORT: String(port), API_KEY: apiKey.value },
  })

  child.on('error', (err) => {
    console.error(pc.red('✗ Failed to spawn detached server:'), err.message)
    process.exitCode = 1
  })

  if (child.pid != null) {
    await fs.writeFile(pidPath, String(child.pid), { mode: 0o600 })
  }
  child.unref()

  console.log(pc.green('✓') + ' Started cursor-claude in the background.')
  console.log('  URL:   ' + pc.cyan(`http://localhost:${port}`))
  console.log('  PID:   ' + (child.pid ?? 'unknown'))
  console.log('  Logs:  ' + pc.dim(logPath))
  console.log('  API key: ' + apiKey.value)
  console.log('  ' + pc.dim(apiKeyHint(apiKey)))
  if (useTunnel) {
    console.log(
      '  ' +
        pc.dim('Tunnel: starting in background — tail ') +
        pc.bold(logPath) +
        pc.dim(' to see the public URL.'),
    )
  }
  console.log()
  console.log(
    pc.dim('  Run ') +
      pc.bold('cursor-claude status') +
      pc.dim(' or ') +
      pc.bold('cursor-claude logout') +
      pc.dim(' to inspect or stop.'),
  )
}

async function readPid(): Promise<number | null> {
  try {
    const raw = await fs.readFile(getPidFilePath(), 'utf8')
    const n = Number(raw.trim())
    return Number.isInteger(n) ? n : null
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function printBanner(
  port: number,
  apiKey: ResolvedApiKey,
  publicUrl: string | null,
): void {
  const localUrl = `http://localhost:${port}`
  const storeKind = getStorageKind()
  const cursorUrl = publicUrl ? `${publicUrl}/v1` : `${localUrl}/v1`

  console.log()
  console.log(pc.bold(pc.green('cursor-claude')) + pc.dim(' is running'))
  console.log()
  console.log('  Local URL:   ' + pc.cyan(localUrl))
  if (publicUrl) {
    console.log('  Public URL:  ' + pc.cyan(publicUrl) + pc.dim(' (ngrok)'))
  }
  console.log()

  console.log(pc.bold('  Configure your IDE:'))
  console.log('    OpenAI Base URL:  ' + cursorUrl)
  console.log('    API key:          ' + apiKey.value)
  console.log('    ' + pc.dim(apiKeyHint(apiKey)))
  console.log()
  console.log('  Storage:     ' + pc.dim(storeKind))
  console.log()

  if (!publicUrl) {
    console.log(
      '  ' +
        pc.yellow('Note for Cursor: ') +
        pc.dim('Cursor requires a public HTTPS URL. Re-run with ') +
        pc.bold('--tunnel') +
        pc.dim(' (or use a remote deploy).'),
    )
    console.log(
      '  ' +
        pc.dim(
          'Other OpenAI-compatible clients (aider, Continue, curl, etc.) can use the local URL directly.',
        ),
    )
    console.log()
  }

  console.log(pc.dim('  Press Ctrl+C to stop.'))
  console.log()
}

function apiKeyHint(apiKey: ResolvedApiKey): string {
  switch (apiKey.source) {
    case 'flag':
      return 'using the key you passed via --api-key (saved for future starts).'
    case 'env':
      return 'using the API_KEY environment variable (not persisted).'
    case 'persisted':
      return 'loaded from ~/.config/cursor-claude/config.json.'
    case 'generated':
      return 'auto-generated and saved to ~/.config/cursor-claude/config.json.'
  }
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n')
}
