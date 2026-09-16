export type TunnelProvider = 'cloudflared' | 'ngrok'

export interface TunnelHandle {
  publicUrl: string
  provider: TunnelProvider
  stop: () => Promise<void>
}

// 'auto' prefers ngrok (stable long-lived streams), falling back to cloudflared.
export type TunnelChoice = TunnelProvider | 'auto'

export type TunnelFactory = (
  localPort: number,
  provider: TunnelChoice,
) => Promise<TunnelHandle>
