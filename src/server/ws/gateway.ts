import type { ServerWebSocket } from 'bun'
import { handleAppWebSocket, type AppWebSocketData } from './appWs.js'
import { handleWebSocket, type WebSocketData } from './handler.js'

export type GatewayWebSocketData = WebSocketData | AppWebSocketData

export const handleGatewayWebSocket = {
  open(ws: ServerWebSocket<GatewayWebSocketData>) {
    if (ws.data.channel === 'app') {
      handleAppWebSocket.open(ws as ServerWebSocket<AppWebSocketData>)
      return
    }

    handleWebSocket.open(ws as ServerWebSocket<WebSocketData>)
  },

  message(ws: ServerWebSocket<GatewayWebSocketData>, rawMessage: string | Buffer) {
    if (ws.data.channel === 'app') {
      handleAppWebSocket.message(ws as ServerWebSocket<AppWebSocketData>, rawMessage)
      return
    }

    handleWebSocket.message(ws as ServerWebSocket<WebSocketData>, rawMessage)
  },

  close(ws: ServerWebSocket<GatewayWebSocketData>, code: number, reason: string) {
    if (ws.data.channel === 'app') {
      handleAppWebSocket.close()
      return
    }

    handleWebSocket.close(ws as ServerWebSocket<WebSocketData>, code, reason)
  },

  drain(ws: ServerWebSocket<GatewayWebSocketData>) {
    if (ws.data.channel === 'app') {
      handleAppWebSocket.drain()
      return
    }

    handleWebSocket.drain(ws as ServerWebSocket<WebSocketData>)
  },
}
