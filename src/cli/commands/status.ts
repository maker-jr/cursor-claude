import { promises as fs } from 'node:fs'
import pc from 'picocolors'
import {
  getAuthFilePath,
  getLogFilePath,
  getPidFilePath,
} from '../../adapters/storage/paths'
import type { Deps } from '../../ports'
import { getStorageKind } from '../composition'

const AUTH_KEY = 'auth:anthropic'

export async function runStatus(deps: Deps): Promise<void> {
  console.log(pc.bold('Auth'))
  const creds = await deps.credentialStore.get(AUTH_KEY)
  if (!creds) {
    console.log('  ' + pc.red('not authenticated'))
    console.log(
      pc.dim('  Run ') + pc.bold('cursor-claude login') + pc.dim('.'),
    )
  } else {
    const valid = creds.expires > deps.clock.now()
    console.log(
      '  ' +
        (valid
          ? pc.green('authenticated')
          : pc.yellow('token expired (will auto-refresh on next request)')),
    )
    console.log('  expires: ' + new Date(creds.expires).toLocaleString())
  }

  const storageKind = getStorageKind()
  console.log('  storage: ' + pc.dim(storageKind))
  if (storageKind === 'file') {
    console.log('  path:    ' + pc.dim(getAuthFilePath()))
  }

  console.log()
  console.log(pc.bold('API key'))
  const envKey = process.env.API_KEY
  const persistedKey = await deps.configStore.getApiKey()
  if (envKey && envKey.length > 0) {
    console.log('  ' + envKey + pc.dim(' (from API_KEY env)'))
  } else if (persistedKey && persistedKey.length > 0) {
    console.log('  ' + persistedKey + pc.dim(' (persisted)'))
  } else {
    console.log(
      '  ' +
        pc.dim('none yet — will be generated on first ') +
        pc.bold('cursor-claude start'),
    )
  }

  console.log()
  console.log(pc.bold('Server'))

  const pid = await readPid()
  if (pid == null) {
    console.log('  ' + pc.dim('no PID file (no detached server tracked)'))
    return
  }
  if (!isProcessAlive(pid)) {
    console.log(
      '  ' + pc.dim(`stale PID file (pid ${pid} is no longer running)`),
    )
    console.log(pc.dim('  Remove with: ') + pc.bold(`rm ${getPidFilePath()}`))
    return
  }
  console.log('  pid:   ' + pid)
  console.log('  logs:  ' + pc.dim(getLogFilePath()))
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
