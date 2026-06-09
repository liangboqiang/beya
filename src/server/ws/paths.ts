export const APP_WS_PATH = '/ws/app'
export const SESSION_WS_CANONICAL_PATH = '/ws/{sessionId}'

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function isAppWebSocketPath(pathname: string): boolean {
  return pathname === APP_WS_PATH
}

export function sessionWebSocketIdFromPath(pathname: string): string | null {
  if (isAppWebSocketPath(pathname)) {
    return null
  }

  const parts = pathname.split('/')
  if (parts.length === 3 && parts[1] === 'ws' && parts[2]) {
    return decodePathSegment(parts[2])
  }

  return null
}
