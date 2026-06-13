import { getAuthToken, getBaseUrl } from './clientState'
import {
  buildRpcResourceCall,
  createRpcResourceCall,
  type JsonValue,
  RPC_PATH,
  type RpcMethod,
  type RpcResourceParams,
} from '../../../src/generated/contracts'

export type AppRpcResponse = {
  status: number
  headers: Record<string, string>
  body: unknown
}

type AppRpcMessage =
  | { type: 'rpc.connected'; schemaHash: string }
  | { type: 'rpc.pong'; id?: string }
  | {
      type: 'rpc.response'
      id: string
      status: number
      headers: Record<string, string>
      result: unknown
    }
  | {
      type: 'rpc.error'
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

export function buildResourceRpcWebSocketUrl() {
  const url = new URL(getBaseUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  url.pathname = `${basePath}${RPC_PATH}`

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
  const call = buildRpcResourceCall({
    httpMethod: input.method,
    path: normalizeResourcePath(input.path),
    headers: input.headers,
    body: input.body as JsonValue | string | undefined,
  })
  const payload = JSON.stringify({
    type: 'rpc.request',
    id,
    method: call.method,
    params: call.params,
  })

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(buildResourceRpcWebSocketUrl())
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
      if (message.type === 'rpc.connected' || message.type === 'rpc.pong') return
      if ('id' in message && message.id !== id) return

      if (message.type === 'rpc.error') {
        complete(() => reject(new AppRpcTransportError(message.message, message.code)))
        return
      }

      complete(() => resolve({
        status: message.status,
        headers: message.headers,
        body: message.result,
      }))
    }

    ws.onerror = () => {
      complete(() => reject(new AppRpcTransportError('Resource RPC failed.')))
    }

    ws.onclose = () => {
      complete(() => reject(new AppRpcTransportError('Resource RPC closed before a response was received.')))
    }
  })
}

export function sendNamedAppRpcRequest(input: {
  method: RpcMethod
  params?: RpcResourceParams
  timeoutMs: number
}): Promise<AppRpcResponse> {
  const id = `resource-rpc-${Date.now()}-${++requestCounter}`
  const call = createRpcResourceCall(input.method, {
    headers: buildHeaders(),
    ...input.params,
  })
  const payload = JSON.stringify({
    type: 'rpc.request',
    id,
    method: call.method,
    params: call.params,
  })

  return sendRpcPayload(id, payload, input.timeoutMs)
}

function normalizeResourcePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = getAuthToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function sendRpcPayload(id: string, payload: string, timeoutMs: number): Promise<AppRpcResponse> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(buildResourceRpcWebSocketUrl())
    let settled = false
    const timeout = setTimeout(() => {
      complete(() => reject(new AppRpcTransportError(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s`,
        'APP_RPC_TIMEOUT',
      )))
    }, timeoutMs)

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
      if (message.type === 'rpc.connected' || message.type === 'rpc.pong') return
      if ('id' in message && message.id !== id) return

      if (message.type === 'rpc.error') {
        complete(() => reject(new AppRpcTransportError(message.message, message.code)))
        return
      }

      complete(() => resolve({
        status: message.status,
        headers: message.headers,
        body: message.result,
      }))
    }

    ws.onerror = () => {
      complete(() => reject(new AppRpcTransportError('Resource RPC failed.')))
    }

    ws.onclose = () => {
      complete(() => reject(new AppRpcTransportError('Resource RPC closed before a response was received.')))
    }
  })
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
