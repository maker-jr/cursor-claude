import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ConfigStore } from '../../ports/config-store'
import { getConfigFilePath } from './paths'

interface CliConfig {
  apiKey?: string
}

async function readConfig(): Promise<CliConfig> {
  try {
    const raw = await fs.readFile(getConfigFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') return parsed as CliConfig
    return {}
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

async function writeConfig(cfg: CliConfig): Promise<void> {
  const path = getConfigFilePath()
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await fs.writeFile(path, JSON.stringify(cfg, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    await fs.chmod(path, 0o600)
  } catch {
    // Non-POSIX filesystems may reject chmod; ignore.
  }
}

export function createJsonConfigStore(): ConfigStore {
  return {
    async getApiKey() {
      const cfg = await readConfig()
      return cfg.apiKey
    },
    async setApiKey(apiKey) {
      const cfg = await readConfig()
      cfg.apiKey = apiKey
      await writeConfig(cfg)
    },
  }
}
