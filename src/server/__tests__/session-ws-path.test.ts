import { describe, expect, it } from 'bun:test'
import {
  RPC_WS_PATH,
  SESSION_LIVE_WS_PATH_TEMPLATE,
  SESSION_RUNTIME_WS_PATH_TEMPLATE,
  isRpcWebSocketPath,
  sessionLiveIdFromPath,
  sessionRuntimeIdFromPath,
} from '../ws/paths.js'

describe('session WebSocket path contract', () => {
  it('uses /sessions/:sessionId/live as the canonical live path', () => {
    expect(SESSION_LIVE_WS_PATH_TEMPLATE).toBe('/sessions/{sessionId}/live')
    expect(sessionLiveIdFromPath('/sessions/session-1/live')).toBe('session-1')
  })

  it('uses /rpc for the resource RPC control plane', () => {
    expect(RPC_WS_PATH).toBe('/rpc')
    expect(isRpcWebSocketPath('/rpc')).toBe(true)
    expect(sessionLiveIdFromPath('/rpc')).toBeNull()
  })

  it('uses /sessions/:sessionId/runtime for the runtime bridge', () => {
    expect(SESSION_RUNTIME_WS_PATH_TEMPLATE).toBe('/sessions/{sessionId}/runtime')
    expect(sessionRuntimeIdFromPath('/sessions/session-1/runtime')).toBe('session-1')
  })

  it('rejects REST-style WebSocket paths as old-route residue', () => {
    expect(sessionLiveIdFromPath('/api/sessions/session-1/ws')).toBeNull()
    expect(sessionLiveIdFromPath('/api/sessions/session-1/chat')).toBeNull()
    expect(sessionLiveIdFromPath('/ws/session-1')).toBeNull()
    expect(sessionRuntimeIdFromPath('/sdk/session-1')).toBeNull()
  })

  it('rejects malformed session WebSocket paths', () => {
    expect(sessionLiveIdFromPath('/sessions/session-1')).toBeNull()
    expect(sessionLiveIdFromPath('/sessions/session-1/live/extra')).toBeNull()
    expect(sessionLiveIdFromPath('/sessions')).toBeNull()
  })
})
