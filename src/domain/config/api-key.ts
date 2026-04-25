import crypto from 'node:crypto'
import type { ConfigStore } from '../../ports/config-store'

export interface ResolvedApiKey {
  value: string
  source: 'flag' | 'env' | 'persisted' | 'generated'
}

export function generateApiKey(): string {
  // 32 random bytes encoded url-safe base64 (~43 chars). `cck_` prefix for recognition.
  return 'cck_' + crypto.randomBytes(32).toString('base64url')
}

export interface ResolveApiKeyInput {
  flag?: string
  envValue?: string
  configStore: ConfigStore
}

/**
 * Resolution order for the API key used by the proxy:
 *  1. `--api-key` flag (persisted for future starts).
 *  2. API_KEY env var (not persisted — env is authoritative each run).
 *  3. Persisted config (from a previous flag or auto-generation).
 *  4. Generate one and persist it.
 */
export async function resolveApiKey(
  input: ResolveApiKeyInput,
): Promise<ResolvedApiKey> {
  const { flag, envValue, configStore } = input

  if (flag && flag.length > 0) {
    await configStore.setApiKey(flag)
    return { value: flag, source: 'flag' }
  }

  if (envValue && envValue.length > 0) {
    return { value: envValue, source: 'env' }
  }

  const persisted = await configStore.getApiKey()
  if (persisted && persisted.length > 0) {
    return { value: persisted, source: 'persisted' }
  }

  const generated = generateApiKey()
  await configStore.setApiKey(generated)
  return { value: generated, source: 'generated' }
}
