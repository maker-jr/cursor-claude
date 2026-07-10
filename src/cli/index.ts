import { config as loadDotenv } from 'dotenv'
import { Command } from 'commander'
import { buildDeps } from './composition'
import { runLogin } from './commands/login'
import { runModels } from './commands/models'
import { runStart } from './commands/start'
import { runStatus } from './commands/status'
import { runLogout } from './commands/logout'

// Load a local .env if present. Not required for the CLI flow, but
// supports power users who want to set API_KEY, REDIS_URL, etc.
// `quiet: true` suppresses dotenv's promotional output on startup.
loadDotenv({ quiet: true })

function readVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../../package.json') as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const program = new Command()

program
  .name('cursor-claude')
  .description(
    'Use your Claude Pro/Max subscription from Cursor (or any OpenAI-compatible IDE) via a local proxy.',
  )
  .version(readVersion(), '-v, --version', 'print the version number')

program
  .command('login')
  .description(
    'authenticate with Claude via OAuth (opens browser, prompts for code)',
  )
  .option('-f, --force', 'force re-authentication even if a valid token exists')
  .option('--no-open', 'do not try to auto-open the browser; print the URL only')
  .action(async (opts: { force?: boolean; open?: boolean }) => {
    await runLogin(buildDeps(), {
      force: !!opts.force,
      openBrowser: opts.open !== false,
    })
  })

program
  .command('start')
  .description('start the local proxy server')
  .option(
    '-p, --port <port>',
    'port to listen on (default 9095; auto-increments if busy)',
    parsePort,
  )
  .option(
    '--no-auto-port',
    'fail if the chosen port is busy instead of trying the next one',
  )
  .option(
    '-d, --detach',
    'run the server in the background; logs to ~/.config/cursor-claude/server.log',
  )
  .option(
    '-t, --tunnel [provider]',
    'expose the proxy via a public HTTPS tunnel (required for Cursor). ' +
      'Provider: cloudflared | ngrok. Default: cloudflared if installed, else ngrok.',
    parseTunnelProvider,
  )
  .option(
    '-k, --api-key <key>',
    'API key clients must send; persisted for future starts. Defaults to a generated key.',
  )
  .action(
    async (opts: {
      port?: number
      autoPort?: boolean
      detach?: boolean
      tunnel?: boolean | 'cloudflared' | 'ngrok'
      apiKey?: string
    }) => {
      await runStart(buildDeps(), {
        port: opts.port,
        autoPort: opts.autoPort !== false,
        detach: !!opts.detach,
        // Bare --tunnel parses to `true`; a value parses to the provider name.
        tunnel:
          opts.tunnel === true ? 'auto' : opts.tunnel ? opts.tunnel : false,
        apiKey: opts.apiKey,
      })
    },
  )

program
  .command('models')
  .description(
    'list Anthropic models available through your subscription (no proxy needed)',
  )
  .option('--json', 'output the OpenAI-shaped models list as JSON')
  .option('--ids-only', 'output one model id per line; ideal for shell pipes')
  .action(async (opts: { json?: boolean; idsOnly?: boolean }) => {
    await runModels(buildDeps(), { json: !!opts.json, idsOnly: !!opts.idsOnly })
  })

program
  .command('status')
  .description('show auth state and running server info')
  .action(async () => {
    await runStatus(buildDeps())
  })

program
  .command('logout')
  .description('remove stored OAuth credentials')
  .action(async () => {
    await runLogout(buildDeps())
  })

function parseTunnelProvider(value: string): 'cloudflared' | 'ngrok' {
  if (value === 'cloudflared' || value === 'ngrok') return value
  throw new Error(
    `Invalid tunnel provider: ${value} (expected "cloudflared" or "ngrok")`,
  )
}

function parsePort(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port: ${value}`)
  }
  return n
}

program
  .parseAsync(process.argv)
  .then(() => {
    // Short-lived commands (login/status/logout) may have opened resources
    // (e.g. an ioredis client) that would keep the event loop alive. The
    // foreground `start` command keeps the process running via the HTTP
    // server; for it, process.exit is a no-op. Force exit in all other cases.
    const code = process.exitCode ?? 0
    if (!isLongRunningCommand(process.argv)) {
      process.exit(code)
    }
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })

function isLongRunningCommand(argv: string[]): boolean {
  const cmd = argv[2]
  if (cmd !== 'start') return false
  return !argv.slice(3).some((a) => a === '-d' || a === '--detach')
}
