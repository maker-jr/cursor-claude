export interface TunnelHandle {
  publicUrl: string
  stop: () => Promise<void>
}

export type TunnelFactory = (localPort: number) => Promise<TunnelHandle>
