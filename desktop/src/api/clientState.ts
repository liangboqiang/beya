const ENV_BASE_URL =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env?.VITE_DESKTOP_SERVER_URL === 'string' &&
  import.meta.env.VITE_DESKTOP_SERVER_URL.length > 0
    ? import.meta.env.VITE_DESKTOP_SERVER_URL
    : undefined

const DEFAULT_BASE_URL = ENV_BASE_URL || 'http://127.0.0.1:3456'

let baseUrl = DEFAULT_BASE_URL
let authToken: string | null = null

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '')
}

export function getBaseUrl() {
  return baseUrl
}

export function getHttpUrl(pathOrUrl: string) {
  try {
    return new URL(pathOrUrl).toString()
  } catch {
    const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
    return `${baseUrl}${normalizedPath}`
  }
}

export function setAuthToken(token: string | null) {
  const trimmed = token?.trim() ?? ''
  authToken = trimmed.length > 0 ? trimmed : null
}

export function getAuthToken() {
  return authToken
}

export function getDefaultBaseUrl() {
  return DEFAULT_BASE_URL
}

export function hasExplicitDefaultBaseUrl() {
  return Boolean(ENV_BASE_URL)
}
