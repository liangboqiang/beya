import type { ServerWebSocket } from 'bun'
import { handleRpcWebSocket, type RpcWebSocketData } from './rpcGateway.js'
import { handleWebSocket, type WebSocketData } from './handler.js'

export type GatewayWebSocketData = WebSocketData | RpcWebSocketData

export const handleGatewayWebSocket = {
  open(ws: ServerWebSocket<GatewayWebSocketData>) {
    if (ws.data.channel === 'rpc') {
      handleRpcWebSocket.open(ws as ServerWebSocket<RpcWebSocketData>)
      return
    }

    handleWebSocket.open(ws as ServerWebSocket<WebSocketData>)
  },

  message(ws: ServerWebSocket<GatewayWebSocketData>, rawMessage: string | Buffer) {
    if (ws.data.channel === 'rpc') {
      handleRpcWebSocket.message(ws as ServerWebSocket<RpcWebSocketData>, rawMessage)
      return
    }

    handleWebSocket.message(ws as ServerWebSocket<WebSocketData>, rawMessage)
  },

  close(ws: ServerWebSocket<GatewayWebSocketData>, code: number, reason: string) {
    if (ws.data.channel === 'rpc') {
      handleRpcWebSocket.close()
      return
    }

    handleWebSocket.close(ws as ServerWebSocket<WebSocketData>, code, reason)
  },

  drain(ws: ServerWebSocket<GatewayWebSocketData>) {
    if (ws.data.channel === 'rpc') {
      handleRpcWebSocket.drain()
      return
    }

    handleWebSocket.drain(ws as ServerWebSocket<WebSocketData>)
  },
}
