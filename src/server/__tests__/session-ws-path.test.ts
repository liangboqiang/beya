import { describe, expect, it } from 'bun:test'
import {
  APP_WS_PATH,
  SESSION_WS_CANONICAL_PATH,
  isAppWebSocketPath,
  sessionWebSocketIdFromPath,
} from '../ws/paths.js'

describe('session WebSocket path contract', () => {
  it('uses /ws/:sessionId as the canonical path', () => {
    expect(SESSION_WS_CANONICAL_PATH).toBe('/ws/{sessionId}')
    expect(sessionWebSocketIdFromPath('/ws/session-1')).toBe('session-1')
  })

  it('reserves /ws/app for the app control plane', () => {
    expect(APP_WS_PATH).toBe('/ws/app')
    expect(isAppWebSocketPath('/ws/app')).toBe(true)
    expect(sessionWebSocketIdFromPath('/ws/app')).toBeNull()
  })

  it('rejects REST-style WebSocket paths as old-route residue', () => {
    expect(sessionWebSocketIdFromPath('/api/sessions/session-1/ws')).toBeNull()
    expect(sessionWebSocketIdFromPath('/api/sessions/session-1/chat')).toBeNull()
  })

  it('rejects malformed session WebSocket paths', () => {
    expect(sessionWebSocketIdFromPath('/ws/')).toBeNull()
    expect(sessionWebSocketIdFromPath('/ws/session-1/extra')).toBeNull()
    expect(sessionWebSocketIdFromPath('/ws')).toBeNull()
  })
})
