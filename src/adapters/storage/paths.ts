import { homedir } from 'node:os'
import { join } from 'node:path'

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config')
  return join(base, 'cursor-claude')
}

export function getAuthFilePath(): string {
  return join(getConfigDir(), 'auth.json')
}

export function getConfigFilePath(): string {
  return join(getConfigDir(), 'config.json')
}

export function getPidFilePath(): string {
  return join(getConfigDir(), 'server.pid')
}

export function getLogFilePath(): string {
  return join(getConfigDir(), 'server.log')
}
