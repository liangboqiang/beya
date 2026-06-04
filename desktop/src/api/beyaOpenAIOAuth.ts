// desktop/src/api/beyaOpenAIOAuth.ts

import { api, getBaseUrl } from './client'

export type BeyaOpenAIOAuthStatus =
  | { loggedIn: false }
  | {
      loggedIn: true
      expiresAt: number | null
      email: string | null
      accountId: string | null
    }

function currentServerPort(): number {
  const port = new URL(getBaseUrl()).port
  const parsed = Number.parseInt(port, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Cannot determine server port from baseUrl: ${getBaseUrl()}`)
  }
  return parsed
}

export const beyaOpenAIOAuthApi = {
  start() {
    return api.post<{ authorizeUrl: string; state: string }>(
      '/api/beya-openai-oauth/start',
      { serverPort: currentServerPort() },
    )
  },

  status() {
    return api.get<BeyaOpenAIOAuthStatus>('/api/beya-openai-oauth')
  },

  logout() {
    return api.delete<{ ok: true }>('/api/beya-openai-oauth')
  },
}
