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
