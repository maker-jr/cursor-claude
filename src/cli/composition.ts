import { createHttpAnthropicClient } from '../adapters/anthropic/http-client'
import { createHttpOAuthClient } from '../adapters/oauth/http-client'
import { consoleLogger } from '../adapters/process/console-logger'
import { systemClock } from '../adapters/process/system-clock'
import { getCredentialStore } from '../adapters/storage/create-credential-store'
import { createJsonConfigStore } from '../adapters/storage/json-config-store'
import { startTunnel } from '../adapters/tunnel'
import type { Deps } from '../ports'

// Composition root: wire all real adapters into a Deps bag for the CLI.
// Tests and integration harnesses construct Deps directly instead of calling
// this.
export function buildDeps(): Deps {
  return {
    credentialStore: getCredentialStore().store,
    configStore: createJsonConfigStore(),
    anthropic: createHttpAnthropicClient(),
    oauth: createHttpOAuthClient(),
    makeTunnel: (port, provider) => startTunnel(port, provider),
    clock: systemClock,
    logger: consoleLogger,
  }
}

// Convenience for CLI commands that also need the storage kind label.
export function getStorageKind(): 'redis' | 'upstash' | 'file' {
  return getCredentialStore().kind
}
