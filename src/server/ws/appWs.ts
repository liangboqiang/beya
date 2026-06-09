import type { ServerWebSocket } from 'bun'
import { handleApiRequest } from '../router.js'

export type AppWebSocketData = {
  channel: 'app'
  connectedAt: number
  serverPort: number
  serverHost: string
  requestKind: 'local-trusted' | 'internal-sdk' | 'h5-browser'
}

type AppWsRequest = {
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: unknown
}

type AppWsClientMessage =
  | { type: 'ping'; id?: string }
  | { type: 'api_request'; id?: string; request?: AppWsRequest }

type AppWsServerMessage =
  | { type: 'connected'; scope: 'app' }
  | { type: 'pong'; id?: string }
  | {
      type: 'api_response'
      id: string
      status: number
      headers: Record<string, string>
      body: unknown
    }
  | {
      type: 'app_error'
      id?: string
      code: string
      message: string
    }

const ALLOWED_APP_RPC_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])

export const handleAppWebSocket = {
  open(ws: ServerWebSocket<AppWebSocketData>) {
    sendAppMessage(ws, { type: 'connected', scope: 'app' })
  },

  message(ws: ServerWebSocket<AppWebSocketData>, rawMessage: string | Buffer) {
    void handleAppWebSocketMessage(ws, rawMessage)
  },

  close() {},

  drain() {},
}

export async function handleAppWebSocketMessage(
  ws: ServerWebSocket<AppWebSocketData>,
  rawMessage: string | Buffer,
): Promise<void> {
  let message: AppWsClientMessage
  try {
    message = JSON.parse(
      typeof rawMessage === 'string' ? rawMessage : rawMessage.toString(),
    ) as AppWsClientMessage
  } catch {
    sendAppMessage(ws, {
      type: 'app_error',
      code: 'INVALID_JSON',
      message: 'App WebSocket message must be valid JSON.',
    })
    return
  }

  if (message.type === 'ping') {
    sendAppMessage(ws, { type: 'pong', id: message.id })
    return
  }

  if (message.type !== 'api_request') {
    sendAppMessage(ws, {
      type: 'app_error',
      code: 'UNKNOWN_MESSAGE_TYPE',
      message: `Unknown app WebSocket message type: ${(message as { type?: unknown }).type}`,
    })
    return
  }

  if (typeof message.id !== 'string' || !message.id) {
    sendAppMessage(ws, {
      type: 'app_error',
      code: 'INVALID_REQUEST',
      message: 'App WebSocket API request must include a non-empty id.',
    })
    return
  }

  if (!isRecord(message.request)) {
    sendAppMessage(ws, {
      type: 'app_error',
      id: message.id,
      code: 'INVALID_REQUEST',
      message: 'App WebSocket API request must include a request object.',
    })
    return
  }

  const response = await handleAppResourceRequest(ws, message.id, message.request)
  sendAppMessage(ws, response)
}

async function handleAppResourceRequest(
  ws: ServerWebSocket<AppWebSocketData>,
  id: string,
  request: AppWsRequest,
): Promise<AppWsServerMessage> {
  if (request.method !== undefined && typeof request.method !== 'string') {
    return {
      type: 'app_error',
      id,
      code: 'INVALID_REQUEST',
      message: 'App WebSocket RPC method must be a string.',
    }
  }

  const method = (request.method || 'GET').toUpperCase()
  if (!ALLOWED_APP_RPC_METHODS.has(method)) {
    return {
      type: 'app_error',
      id,
      code: 'METHOD_NOT_ALLOWED',
      message: `Method ${method} is not allowed on app WebSocket RPC.`,
    }
  }

  if (request.path !== undefined && typeof request.path !== 'string') {
    return {
      type: 'app_error',
      id,
      code: 'INVALID_REQUEST',
      message: 'App WebSocket resource path must be a string.',
    }
  }

  const path = request.path || ''
  if (!path.startsWith('/') || path.includes('://')) {
    return {
      type: 'app_error',
      id,
      code: 'PATH_NOT_ALLOWED',
      message: 'App WebSocket RPC can only call absolute resource paths.',
    }
  }

  if (path === '/api' || path.startsWith('/api/')) {
    return {
      type: 'app_error',
      id,
      code: 'PATH_NOT_ALLOWED',
      message: 'HTTP /api resource paths are retired; use app resource paths without /api.',
    }
  }

  if (path.startsWith('/ws/') ||
    path.startsWith('/sdk/') ||
    path.startsWith('/proxy/') ||
    path.startsWith('/local-file/') ||
    path.startsWith('/preview-fs/') ||
    path.startsWith('/open-target-icons/')
  ) {
    return {
      type: 'app_error',
      id,
      code: 'PATH_NOT_ALLOWED',
      message: 'App WebSocket RPC cannot call transport or file-serving paths.',
    }
  }

  if (isH5AccessControlResource(path) && ws.data.requestKind !== 'local-trusted') {
    return {
      type: 'api_response',
      id,
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: {
        error: 'Forbidden',
        message: 'H5 access settings can only be changed from the local desktop app.',
      },
    }
  }

  if (isLocalInteractiveFilesystemResource(path) && ws.data.requestKind !== 'local-trusted') {
    return {
      type: 'api_response',
      id,
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: {
        error: 'Forbidden',
        message: 'Interactive filesystem selection is only available from the local desktop app or loopback Web UI.',
      },
    }
  }

  if (request.headers !== undefined && !isStringRecord(request.headers)) {
    return {
      type: 'app_error',
      id,
      code: 'INVALID_REQUEST',
      message: 'App WebSocket RPC headers must be a string map.',
    }
  }

  const headers = new Headers(request.headers || {})
  let body: BodyInit | undefined
  if (request.body !== undefined && method !== 'GET') {
    if (typeof request.body === 'string') {
      body = request.body
    } else {
      body = JSON.stringify(request.body)
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json')
      }
    }
  }

  const url = new URL(`/api${path}`, 'http://127.0.0.1')
  const response = await handleApiRequest(
    new Request(url, { method, headers, body }),
    url,
  )
  const responseHeaders = Object.fromEntries(response.headers.entries())
  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''
  const responseBody = parseResponseBody(text, contentType)

  return {
    type: 'api_response',
    id,
    status: response.status,
    headers: responseHeaders,
    body: responseBody,
  }
}

function parseResponseBody(text: string, contentType: string): unknown {
  if (!text) {
    return null
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false
  }

  return Object.values(value).every((entry) => typeof entry === 'string')
}

function isH5AccessControlResource(path: string): boolean {
  if (!path.startsWith('/h5-access')) {
    return false
  }

  return path !== '/h5-access/verify'
}

function isLocalInteractiveFilesystemResource(path: string): boolean {
  return path === '/filesystem/pick-directory' ||
    path === '/filesystem/register-directory'
}

function sendAppMessage(
  ws: ServerWebSocket<AppWebSocketData>,
  message: AppWsServerMessage,
) {
  ws.send(JSON.stringify(message))
}
