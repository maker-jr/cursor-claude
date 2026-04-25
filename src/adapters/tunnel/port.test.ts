import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { findFreePort, isPortFree } from './port'

describe('port probe', () => {
  const servers: net.Server[] = []

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve())
          }),
      ),
    )
  })

  async function bindOne(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = net.createServer()
      s.once('error', reject)
      s.listen(0, () => {
        const addr = s.address()
        if (addr && typeof addr === 'object') {
          servers.push(s)
          resolve(addr.port)
        } else {
          reject(new Error('no address'))
        }
      })
    })
  }

  it('reports a bound port as not free', async () => {
    const port = await bindOne()
    expect(await isPortFree(port)).toBe(false)
  })

  it('findFreePort returns the first free port starting from the given number', async () => {
    const taken = await bindOne()
    const result = await findFreePort(taken, 10)
    expect(result).not.toBe(taken)
    expect(typeof result).toBe('number')
  })

  it('findFreePort returns null when no ports are free in the attempt window', async () => {
    // This is hard to assert definitively without monopolizing the full range,
    // so approximate by restricting attempts to a single taken port.
    const taken = await bindOne()
    const result = await findFreePort(taken, 1)
    expect(result).toBeNull()
  })
})
