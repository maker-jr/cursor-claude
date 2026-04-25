import readline from 'node:readline'
import pc from 'picocolors'
import { generatePKCE, getAuthorizationUrl } from '../../domain/auth/pkce'
import { decideTokenAction } from '../../domain/auth/token-lifecycle'
import type { Deps } from '../../ports'
import {
  getClientId,
  REDIRECT_URI,
} from '../../adapters/oauth/http-client'

export interface LoginOptions {
  force: boolean
  openBrowser: boolean
}

const AUTH_KEY = 'auth:anthropic'

export async function runLogin(
  deps: Deps,
  opts: LoginOptions,
): Promise<void> {
  if (!opts.force) {
    const existing = await deps.credentialStore.get(AUTH_KEY)
    const decision = decideTokenAction(existing, deps.clock.now())
    if (decision.kind === 'valid') {
      console.log(pc.green('✓') + ' Already authenticated with Claude.')
      if (existing) {
        console.log(
          pc.dim(
            `  Token expires ${formatFutureTime(existing.expires, deps.clock.now())}. Use --force to re-authenticate.`,
          ),
        )
      }
      return
    }
  }

  const pkce = generatePKCE()
  const authUrl = getAuthorizationUrl({
    clientId: getClientId(),
    redirectUri: REDIRECT_URI,
    pkce,
  })

  console.log()
  console.log(pc.bold('Claude OAuth login'))
  console.log()
  console.log('1. Open the following URL in your browser:')
  console.log()
  console.log('   ' + pc.cyan(authUrl))
  console.log()

  if (opts.openBrowser) {
    await tryOpenBrowser(authUrl)
  }

  console.log('2. Sign in, authorize the app, and copy the ENTIRE code')
  console.log(pc.dim('   (it includes a "#" in the middle).'))
  console.log()

  const code = await promptCode()
  if (!code) {
    console.error(pc.red('No code provided. Aborting.'))
    process.exitCode = 1
    return
  }

  try {
    const tokens = await deps.oauth.exchangeCode(code, pkce.verifier)
    await deps.credentialStore.set(AUTH_KEY, {
      type: 'oauth',
      refresh: tokens.refresh_token,
      access: tokens.access_token,
      expires: deps.clock.now() + tokens.expires_in * 1000,
    })
    console.log()
    console.log(pc.green('✓') + ' Authentication successful.')
    console.log(
      pc.dim('  Run ') +
        pc.bold('cursor-claude start') +
        pc.dim(' to launch the proxy.'),
    )
  } catch (err) {
    console.error(pc.red('✗ Authentication failed:'))
    console.error('  ' + (err instanceof Error ? err.message : String(err)))
    process.exitCode = 1
  }
}

async function tryOpenBrowser(url: string): Promise<void> {
  try {
    const mod = await import('open')
    const openFn = (mod as unknown as { default: (u: string) => Promise<unknown> }).default
    await openFn(url)
  } catch {
    // Best-effort. User already has the URL printed above.
  }
}

function promptCode(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(pc.bold('Paste code here: '), (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function formatFutureTime(epochMs: number, now: number): string {
  const diffMs = epochMs - now
  if (diffMs <= 0) return 'soon'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return `in ${hours}h ${rem}m`
  const days = Math.floor(hours / 24)
  return `in ${days}d ${hours % 24}h`
}
