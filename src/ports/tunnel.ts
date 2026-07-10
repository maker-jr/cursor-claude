export type TunnelProvider = 'cloudflared' | 'ngrok'

export interface TunnelHandle {
  publicUrl: string
  provider: TunnelProvider
  stop: () => Promise<void>
}

// 'auto' picks cloudflared when installed (faster, no agent limit), else ngrok.
export type TunnelChoice = TunnelProvider | 'auto'

export type TunnelFactory = (
  localPort: number,
  provider: TunnelChoice,
) => Promise<TunnelHandle>
