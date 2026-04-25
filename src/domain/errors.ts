// Domain-level error types. Adapters translate these into HTTP/CLI surfaces.

export class AuthError extends Error {
  readonly code: 'missing' | 'expired' | 'refresh-failed' | 'upstream-401'
  constructor(
    code: AuthError['code'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'AuthError'
    this.code = code
  }
}

export class ProxyError extends Error {
  readonly status: number
  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProxyError'
    this.status = status
  }
}

export class TunnelError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TunnelError'
  }
}
