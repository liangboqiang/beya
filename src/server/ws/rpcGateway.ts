import type { ServerWebSocket } from 'bun'
import {
  CONTRACT_SCHEMA_HASH,
  isRpcMethod,
  resolveRpcResourceCall,
  type RpcMethod,
} from '../../generated/contracts/index.js'
import { handleResourceRequest } from '../router.js'
import { sessionLiveIdFromPath, sessionRuntimeIdFromPath } from './paths.js'

export type RpcWebSocketData = {
  channel: 'rpc'
  connectedAt: number
  serverPort: number
  serverHost: string
  requestKind: 'local-trusted' | 'internal-runtime' | 'h5-browser'
}

type RpcClientMessage =
  | { type: 'rpc.ping'; id?: string }
  | { type: 'rpc.request'; id?: string; method?: unknown; params?: unknown }

type RpcServerMessage =
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

const ALLOWED_RPC_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])

export const handleRpcWebSocket = {
  open(ws: ServerWebSocket<RpcWebSocketData>) {
    sendRpcMessage(ws, { type: 'rpc.connected', schemaHash: CONTRACT_SCHEMA_HASH })
  },

  message(ws: ServerWebSocket<RpcWebSocketData>, rawMessage: string | Buffer) {
    void handleRpcWebSocketMessage(ws, rawMessage)
  },

  close() {},

  drain() {},
}

export async function handleRpcWebSocketMessage(
  ws: ServerWebSocket<RpcWebSocketData>,
  rawMessage: string | Buffer,
): Promise<void> {
  let message: RpcClientMessage
  try {
    message = JSON.parse(
      typeof rawMessage === 'string' ? rawMessage : rawMessage.toString(),
    ) as RpcClientMessage
  } catch {
    sendRpcMessage(ws, {
      type: 'rpc.error',
      code: 'INVALID_JSON',
      message: 'RPC WebSocket message must be valid JSON.',
    })
    return
  }

  if (message.type === 'rpc.ping') {
    sendRpcMessage(ws, { type: 'rpc.pong', id: message.id })
    return
  }

  if (message.type !== 'rpc.request') {
    sendRpcMessage(ws, {
      type: 'rpc.error',
      code: 'UNKNOWN_MESSAGE_TYPE',
      message: `Unknown RPC WebSocket message type: ${(message as { type?: unknown }).type}`,
    })
    return
  }

  if (typeof message.id !== 'string' || !message.id) {
    sendRpcMessage(ws, {
      type: 'rpc.error',
      code: 'INVALID_REQUEST',
      message: 'RPC request must include a non-empty id.',
    })
    return
  }

  if (!isRpcMethod(message.method)) {
    sendRpcMessage(ws, {
      type: 'rpc.error',
      id: message.id,
      code: 'INVALID_REQUEST',
      message: 'RPC request must include a known contract method.',
    })
    return
  }

  const response = await handleRpcResourceRequest(ws, message.id, message.method, message.params)
  sendRpcMessage(ws, response)
}

async function handleRpcResourceRequest(
  ws: ServerWebSocket<RpcWebSocketData>,
  id: string,
  method: RpcMethod,
  params: unknown,
): Promise<RpcServerMessage> {
  const request = resolveRpcResourceCall(method, params)
  if (!request) {
    return {
      type: 'rpc.error',
      id,
      code: 'INVALID_REQUEST',
      message: `RPC method ${method} received invalid params.`,
    }
  }

  const httpMethod = request.httpMethod.toUpperCase()
  if (!ALLOWED_RPC_METHODS.has(httpMethod)) {
    return {
      type: 'rpc.error',
      id,
      code: 'METHOD_NOT_ALLOWED',
      message: `Method ${httpMethod} is not allowed on RPC WebSocket.`,
    }
  }

  const path = request.path || ''
  if (!path.startsWith('/') || path.includes('://')) {
    return {
      type: 'rpc.error',
      id,
      code: 'PATH_NOT_ALLOWED',
      message: 'RPC WebSocket can only call absolute resource paths.',
    }
  }

  if (path === '/rpc' ||
    sessionLiveIdFromPath(path) !== null ||
    sessionRuntimeIdFromPath(path) !== null ||
    path.startsWith('/proxy/') ||
    path.startsWith('/files/local/') ||
    path.startsWith('/files/preview/') ||
    path.startsWith('/open-target-icons/')
  ) {
    return {
      type: 'rpc.error',
      id,
      code: 'PATH_NOT_ALLOWED',
      message: 'RPC WebSocket cannot call transport or file-serving paths.',
    }
  }

  if (isH5AccessControlResource(path) && ws.data.requestKind !== 'local-trusted') {
    return {
      type: 'rpc.response',
      id,
      status: 403,
      headers: { 'content-type': 'application/json' },
      result: {
        error: 'Forbidden',
        message: 'H5 access settings can only be changed from the local desktop app.',
      },
    }
  }

  if (isLocalInteractiveFilesystemResource(path) && ws.data.requestKind !== 'local-trusted') {
    return {
      type: 'rpc.response',
      id,
      status: 403,
      headers: { 'content-type': 'application/json' },
      result: {
        error: 'Forbidden',
        message: 'Interactive filesystem selection is only available from the local desktop app or loopback Web UI.',
      },
    }
  }

  if (request.headers !== undefined && !isStringRecord(request.headers)) {
    return {
      type: 'rpc.error',
      id,
      code: 'INVALID_REQUEST',
      message: 'RPC WebSocket headers must be a string map.',
    }
  }

  const headers = new Headers(request.headers || {})
  let body: BodyInit | undefined
  if (request.body !== undefined && httpMethod !== 'GET') {
    if (typeof request.body === 'string') {
      body = request.body
    } else {
      body = JSON.stringify(request.body)
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json')
      }
    }
  }

  const url = new URL(path, 'http://127.0.0.1')
  const response = await handleResourceRequest(
    new Request(url, { method: httpMethod, headers, body }),
    url,
  )
  const responseHeaders = Object.fromEntries(response.headers.entries())
  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''
  const responseBody = parseResponseBody(text, contentType)

  return {
    type: 'rpc.response',
    id,
    status: response.status,
    headers: responseHeaders,
    result: responseBody,
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

function sendRpcMessage(
  ws: ServerWebSocket<RpcWebSocketData>,
  message: RpcServerMessage,
) {
  ws.send(JSON.stringify(message))
}
