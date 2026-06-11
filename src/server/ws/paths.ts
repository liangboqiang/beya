import {
  RPC_PATH,
  SESSION_LIVE_PATH_TEMPLATE,
  SESSION_RUNTIME_PATH_TEMPLATE,
} from '../../generated/contracts/index.js'

export const RPC_WS_PATH = RPC_PATH
export const SESSION_LIVE_WS_PATH_TEMPLATE = SESSION_LIVE_PATH_TEMPLATE
export const SESSION_RUNTIME_WS_PATH_TEMPLATE = SESSION_RUNTIME_PATH_TEMPLATE

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function isRpcWebSocketPath(pathname: string): boolean {
  return pathname === RPC_WS_PATH
}

export function sessionLiveIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/')
  if (parts.length === 4 && parts[1] === 'sessions' && parts[2] && parts[3] === 'live') {
    return decodePathSegment(parts[2])
  }

  return null
}

export function sessionRuntimeIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/')
  if (parts.length === 4 && parts[1] === 'sessions' && parts[2] && parts[3] === 'runtime') {
    return decodePathSegment(parts[2])
  }

  return null
}

export function buildSessionRuntimeWebSocketUrl(input: {
  host: string
  port: number
  sessionId: string
  token: string
}): string {
  const path = SESSION_RUNTIME_WS_PATH_TEMPLATE.replace(
    '{sessionId}',
    encodeURIComponent(input.sessionId),
  )
  return `ws://${input.host}:${input.port}${path}?token=${encodeURIComponent(input.token)}`
}
