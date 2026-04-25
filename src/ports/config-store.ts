export interface ConfigStore {
  getApiKey(): Promise<string | undefined>
  setApiKey(apiKey: string): Promise<void>
}
