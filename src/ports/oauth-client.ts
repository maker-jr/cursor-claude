export interface OAuthTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

export interface OAuthClient {
  exchangeCode(code: string, verifier: string): Promise<OAuthTokenResponse>
  refreshToken(refresh: string): Promise<OAuthTokenResponse>
}
