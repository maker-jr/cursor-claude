import net from 'node:net'
import type { Server } from 'node:http'

/**
 * Tune a Node HTTP server for operation behind a tunnel with long-lived SSE
 * responses.
 *
 * - `keepAliveTimeout` defaults to 5s. The tunnel agent in front pools
 *   connections and reuses them; every time Node closes one first, the
 *   in-flight request dies with a reset at the edge — surfacing as random
 *   slow or dropped requests. Keep connections open far longer than any
 *   tunnel's own idle timeout.
 * - `requestTimeout` defaults to 5 minutes and tears the socket down even
 *   while a streaming response is still being written. Long generations
 *   easily exceed it; disable it (this is a personal single-user proxy, not
 *   a public server needing slow-loris protection).
 */
export function tuneHttpServer(server: unknown): void {
  const s = server as Server
  s.keepAliveTimeout = 120_000
  // Must exceed keepAliveTimeout so a request arriving just before the
  // keep-alive deadline can still deliver its headers.
  s.headersTimeout = 125_000
  s.requestTimeout = 0
}

/**
 * Enable happy-eyeballs (RFC 8305) connection racing for all outgoing
 * sockets. api.anthropic.com is dual-stack; on Node 18 (where this is off by
 * default) a machine with a broken IPv6 path stalls for seconds on every
 * fresh connection before falling back to IPv4. Node 20+ already defaults to
 * true, and older 18.x lacks the API — hence the feature check.
 */
export function enableHappyEyeballs(): void {
  if (typeof net.setDefaultAutoSelectFamily === 'function') {
    net.setDefaultAutoSelectFamily(true)
  }
}

// Socket-level errors that mean "the peer went away", nothing more. These are
// routine on an unstable network or when the tunnel edge recycles a
// connection, and must never take the proxy down.
const CLIENT_DISCONNECT_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
])

/** Exported for tests. */
export function isClientDisconnectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as NodeJS.ErrnoException).code
  if (code !== undefined && CLIENT_DISCONNECT_CODES.has(code)) return true
  // Node's http server raises `Error: aborted` when the inbound socket
  // closes mid-request (abortIncoming in _http_server).
  return err.message === 'aborted'
}

/**
 * Keep the proxy alive through client-side connection drops.
 *
 * When the tunnel or Cursor's backend resets its socket mid-request, Node
 * emits the error asynchronously (`abortIncoming` → `Error: aborted`,
 * ECONNRESET) with no request context left to attach a handler to — it
 * surfaces as an uncaught exception and, by default, kills the whole server.
 * The dropped request itself is unrecoverable (the client retries), but every
 * other in-flight stream should survive.
 *
 * Only recognized disconnect errors are swallowed; anything else preserves
 * the default crash-loudly behavior.
 */
export function installDisconnectGuards(server: unknown): void {
  const s = server as Server

  // Resets/garbage on a socket before a request is parsed: drop it quietly.
  s.on('clientError', (_err, socket) => {
    socket.destroy()
  })

  process.on('uncaughtException', (err) => {
    if (isClientDisconnectError(err)) {
      const code = (err as NodeJS.ErrnoException).code ?? err.message
      console.warn(
        `client connection dropped mid-request (${code}); continuing`,
      )
      return
    }
    console.error(err)
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    if (isClientDisconnectError(reason)) {
      const code = (reason as NodeJS.ErrnoException).code ?? 'aborted'
      console.warn(
        `client connection dropped mid-request (${code}); continuing`,
      )
      return
    }
    console.error(reason)
    process.exit(1)
  })
}
