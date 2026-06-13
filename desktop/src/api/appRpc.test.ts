import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildResourceRpcWebSocketUrl, sendAppRpcRequest } from './appRpc'
import { getDefaultBaseUrl, setAuthToken, setBaseUrl } from './clientState'

type SocketHandler = (() => void) | ((event: { data: string }) => void)

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: SocketHandler | null = null
  onmessage: SocketHandler | null = null
  onclose: SocketHandler | null = null
  onerror: SocketHandler | null = null
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    ;(this.onopen as (() => void) | null)?.()
  }

  receive(data: unknown) {
    ;(this.onmessage as ((event: { data: string }) => void) | null)?.({ data: JSON.stringify(data) })
  }
}

describe('resource WebSocket RPC transport', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    setBaseUrl(getDefaultBaseUrl())
    setAuthToken(null)
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    setBaseUrl(getDefaultBaseUrl())
    setAuthToken(null)
    vi.restoreAllMocks()
  })

  it('builds the resource RPC WebSocket URL with token query params', () => {
    setBaseUrl('https://public.example.com/app')
    setAuthToken('h5 token/with?chars')

    expect(buildResourceRpcWebSocketUrl()).toBe(
      'wss://public.example.com/app/rpc?token=h5+token%2Fwith%3Fchars',
    )
  })

  it('sends contract RPC methods through the resource WebSocket', async () => {
    const result = sendAppRpcRequest({
      method: 'GET',
      path: '/status',
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 1_000,
    })

    const ws = FakeWebSocket.instances[0]
    expect(ws?.url).toBe('ws://127.0.0.1:3456/rpc')

    ws!.open()
    const payload = JSON.parse(ws!.sent[0]!)
    expect(payload).toMatchObject({
      type: 'rpc.request',
      method: 'status.read',
      params: {
        headers: { 'Content-Type': 'application/json' },
      },
    })

    ws!.receive({
      type: 'rpc.connected',
      schemaHash: 'test-hash',
    })
    ws!.receive({
      type: 'rpc.response',
      id: payload.id,
      status: 200,
      headers: {},
      result: { ok: true },
    })

    await expect(result).resolves.toEqual({
      status: 200,
      headers: {},
      body: { ok: true },
    })
  })
})
