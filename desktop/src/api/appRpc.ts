import { getAuthToken, getBaseUrl } from './clientState'

export type AppRpcResponse = {
  status: number
  headers: Record<string, string>
  body: unknown
}

type AppRpcMessage =
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

export class AppRpcTransportError extends Error {
  constructor(message: string, public code = 'APP_RPC_TRANSPORT_ERROR') {
    super(message)
    this.name = 'AppRpcTransportError'
  }
}

let requestCounter = 0

export function buildAppWebSocketUrl() {
  const url = new URL(getBaseUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  url.pathname = `${basePath}/ws/app`

  const token = getAuthToken()
  if (token) {
    url.searchParams.set('token', token)
  } else {
    url.searchParams.delete('token')
  }

  return url.toString()
}

export function sendAppRpcRequest(input: {
  method: string
  path: string
  headers: Record<string, string>
  body?: unknown
  timeoutMs: number
}): Promise<AppRpcResponse> {
  const id = `app-rpc-${Date.now()}-${++requestCounter}`
  const payload = JSON.stringify({
    type: 'api_request',
    id,
    request: {
      method: input.method,
      path: normalizeResourcePath(input.path),
      headers: input.headers,
      body: input.body,
    },
  })

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(buildAppWebSocketUrl())
    let settled = false
    const timeout = setTimeout(() => {
      complete(() => reject(new AppRpcTransportError(
        `Request timed out after ${Math.round(input.timeoutMs / 1000)}s`,
        'APP_RPC_TIMEOUT',
      )))
    }, input.timeoutMs)

    function complete(action: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
      action()
    }

    ws.onopen = () => {
      ws.send(payload)
    }

    ws.onmessage = (event) => {
      const message = parseAppRpcMessage(event.data)
      if (!message) return
      if (message.type === 'connected' || message.type === 'pong') return
      if ('id' in message && message.id !== id) return

      if (message.type === 'app_error') {
        complete(() => reject(new AppRpcTransportError(message.message, message.code)))
        return
      }

      complete(() => resolve({
        status: message.status,
        headers: message.headers,
        body: message.body,
      }))
    }

    ws.onerror = () => {
      complete(() => reject(new AppRpcTransportError('App WebSocket RPC failed.')))
    }

    ws.onclose = () => {
      complete(() => reject(new AppRpcTransportError('App WebSocket RPC closed before a response was received.')))
    }
  })
}

function normalizeResourcePath(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return normalizedPath
}

function parseAppRpcMessage(data: unknown): AppRpcMessage | null {
  if (typeof data !== 'string') return null
  try {
    const parsed = JSON.parse(data) as AppRpcMessage
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
