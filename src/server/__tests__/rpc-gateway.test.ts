import { describe, expect, it, mock } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import {
  handleRpcWebSocket,
  handleRpcWebSocketMessage,
  type RpcWebSocketData,
} from '../ws/rpcGateway.js'

function makeRpcSocket() {
  const sent: string[] = []
  return {
    data: {
      channel: 'rpc',
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
  } as unknown as ServerWebSocket<RpcWebSocketData> & { sent: string[] }
}

function sentMessages(ws: { sent: string[] }): unknown[] {
  return ws.sent.map((payload) => JSON.parse(payload))
}

describe('RPC WebSocket control plane', () => {
  it('acknowledges rpc-scope connections', () => {
    const ws = makeRpcSocket()

    handleRpcWebSocket.open(ws)

    expect(sentMessages(ws)).toEqual([{
      type: 'rpc.connected',
      schemaHash: expect.any(String),
    }])
  })

  it('handles resource requests over RPC WebSocket', async () => {
    const ws = makeRpcSocket()

    await handleRpcWebSocketMessage(ws, JSON.stringify({
      type: 'rpc.request',
      id: 'req-1',
      method: 'health.check',
      params: {},
    }))

    expect(sentMessages(ws)).toEqual([
      {
        type: 'rpc.response',
        id: 'req-1',
        status: 200,
        headers: expect.objectContaining({ 'content-type': expect.stringContaining('application/json') }),
        result: expect.objectContaining({
          status: 'ok',
          service: 'beya-server',
        }),
      },
    ])
  })

  it('rejects the removed generic resource request escape hatch', async () => {
    const ws = makeRpcSocket()

    await handleRpcWebSocketMessage(ws, JSON.stringify({
      type: 'rpc.request',
      id: 'req-2',
      method: 'resources.request',
      params: { httpMethod: 'GET', resource: '/sessions/session-1/live' },
    }))

    expect(sentMessages(ws)).toEqual([
      {
        type: 'rpc.error',
        id: 'req-2',
        code: 'INVALID_REQUEST',
        message: 'RPC request must include a known contract method.',
      },
    ])
  })

  it('rejects retired HTTP api paths because no generic resource method exists', async () => {
    const ws = makeRpcSocket()

    await handleRpcWebSocketMessage(ws, JSON.stringify({
      type: 'rpc.request',
      id: 'req-old-api',
      method: 'resources.request',
      params: { httpMethod: 'GET', resource: '/api/health' },
    }))

    expect(sentMessages(ws)).toEqual([
      {
        type: 'rpc.error',
        id: 'req-old-api',
        code: 'INVALID_REQUEST',
        message: 'RPC request must include a known contract method.',
      },
    ])
  })

  it('rejects malformed rpc requests without throwing', async () => {
    const ws = makeRpcSocket()

    await handleRpcWebSocketMessage(ws, JSON.stringify({
      type: 'rpc.request',
      id: 'req-3',
    }))

    expect(sentMessages(ws)).toEqual([
      {
        type: 'rpc.error',
        id: 'req-3',
        code: 'INVALID_REQUEST',
        message: 'RPC request must include a known contract method.',
      },
    ])
  })
})
