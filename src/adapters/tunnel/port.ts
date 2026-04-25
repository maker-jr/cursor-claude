import net from 'node:net'

export async function isPortFree(port: number): Promise<boolean> {
  // Probe the same way @hono/node-server binds — on all interfaces — so we
  // correctly detect cases where a server is bound to 0.0.0.0 or ::.
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true))
      })
      .listen(port)
  })
}

export async function findFreePort(
  start: number,
  attempts = 10,
): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    const candidate = start + i
    if (candidate > 65535) break
    if (await isPortFree(candidate)) return candidate
  }
  return null
}
