import { describe, expect, it } from 'bun:test'
import {
  SESSION_WS_CANONICAL_PATH,
  sessionWebSocketIdFromPath,
} from '../ws/sessionWsPath.js'

describe('session WebSocket path contract', () => {
  it('uses /ws/:sessionId as the canonical path', () => {
    expect(SESSION_WS_CANONICAL_PATH).toBe('/ws/{sessionId}')
    expect(sessionWebSocketIdFromPath('/ws/session-1')).toBe('session-1')
  })

  it('rejects REST-style WebSocket paths as old-route residue', () => {
    expect(sessionWebSocketIdFromPath('/api/sessions/session-1/ws')).toBeNull()
    expect(sessionWebSocketIdFromPath('/api/sessions/session-1/chat')).toBeNull()
  })
})
