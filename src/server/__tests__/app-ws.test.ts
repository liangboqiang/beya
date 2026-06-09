import { describe, expect, it, mock } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import {
  handleAppWebSocket,
  handleAppWebSocketMessage,
  type AppWebSocketData,
} from '../ws/appWs.js'

function makeAppSocket() {
  const sent: string[] = []
  return {
    data: {
      channel: 'app',
      connectedAt: Date.now(),
      serverPort: 3456,
      serverHost: '127.0.0.1',
      requestKind: 'local-trusted',
    },
    send: mock((payload: string) => {
      sent.push(payload)
    }),
    close: mock(() => {}),
    sent,
  } as unknown as ServerWebSocket<AppWebSocketData> & { sent: string[] }
}

function sentMessages(ws: { sent: string[] }): unknown[] {
  return ws.sent.map((payload) => JSON.parse(payload))
}

describe('app WebSocket control plane', () => {
  it('acknowledges app-scope connections', () => {
    const ws = makeAppSocket()

    handleAppWebSocket.open(ws)

    expect(sentMessages(ws)).toEqual([{ type: 'connected', scope: 'app' }])
  })

  it('handles resource requests over app WebSocket RPC', async () => {
    const ws = makeAppSocket()

    await handleAppWebSocketMessage(ws, JSON.stringify({
      type: 'api_request',
      id: 'req-1',
      request: { method: 'GET', path: '/health' },
    }))

    expect(sentMessages(ws)).toEqual([
      {
        type: 'api_response',
        id: 'req-1',
        status: 200,
        headers: expect.objectContaining({ 'content-type': expect.stringContaining('application/json') }),
        body: expect.objectContaining({
          status: 'ok',
          service: 'beya-server',
        }),
      },
    ])
  })

  it('rejects transport paths so app RPC cannot become a second router tree', async () => {
    const ws = makeAppSocket()

    await handleAppWebSocketMessage(ws, JSON.stringify({
      type: 'api_request',
      id: 'req-2',
      request: { method: 'GET', path: '/ws/session-1' },
    }))

    expect(sentMessages(ws)).toEqual([
      {
        type: 'app_error',
        id: 'req-2',
        code: 'PATH_NOT_ALLOWED',
        message: 'App WebSocket RPC cannot call transport or file-serving paths.',
      },
    ])
  })

  it('rejects retired HTTP api paths', async () => {
    const ws = makeAppSocket()

    await handleAppWebSocketMessage(ws, JSON.stringify({
      type: 'api_request',
      id: 'req-old-api',
      request: { method: 'GET', path: '/api/health' },
    }))

    expect(sentMessages(ws)).toEqual([
      {
        type: 'app_error',
        id: 'req-old-api',
        code: 'PATH_NOT_ALLOWED',
        message: 'HTTP /api resource paths are retired; use app resource paths without /api.',
      },
    ])
  })

  it('rejects malformed api requests without throwing', async () => {
    const ws = makeAppSocket()

    await handleAppWebSocketMessage(ws, JSON.stringify({
      type: 'api_request',
      id: 'req-3',
    }))

    expect(sentMessages(ws)).toEqual([
      {
        type: 'app_error',
        id: 'req-3',
        code: 'INVALID_REQUEST',
        message: 'App WebSocket API request must include a request object.',
      },
    ])
  })
})
