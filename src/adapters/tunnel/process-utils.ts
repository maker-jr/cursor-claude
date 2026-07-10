import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'

/** Resolve true when `bin` runs and exits 0 (e.g. `ngrok version`). */
export function binaryWorks(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(bin, args, { stdio: 'ignore' })
    probe.once('error', () => resolve(false))
    probe.once('exit', (code) => resolve(code === 0))
  })
}

/** SIGTERM the child, escalating to SIGKILL after 2s if it ignores it. */
export function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    const done = () => resolve()
    child.once('exit', done)
    try {
      child.kill('SIGTERM')
    } catch {
      resolve()
      return
    }
    setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
    }, 2000)
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
