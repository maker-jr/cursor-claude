import type { Logger } from '../../ports/logger'

function format(message: string, meta?: Record<string, unknown>): string {
  if (!meta) return message
  try {
    return `${message} ${JSON.stringify(meta)}`
  } catch {
    return message
  }
}

export const consoleLogger: Logger = {
  info: (m, meta) => console.log(format(m, meta)),
  warn: (m, meta) => console.warn(format(m, meta)),
  error: (m, meta) => console.error(format(m, meta)),
}

export function createSilentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}
