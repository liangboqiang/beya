export const SESSION_WS_CANONICAL_PATH = '/ws/{sessionId}'

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function sessionWebSocketIdFromPath(pathname: string): string | null {
  if (pathname.startsWith('/ws/')) {
    return decodePathSegment(pathname.split('/').pop() || '')
  }

  return null
}
