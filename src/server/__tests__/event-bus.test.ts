import { describe, expect, it } from 'bun:test'
import { serverEventBus } from '../events/eventBus.js'

describe('server event bus', () => {
  it('dispatches contract-defined events', () => {
    const received: unknown[] = []
    const off = serverEventBus.on('session.created', (payload) => {
      received.push(payload)
    })

    serverEventBus.emit('session.created', { sessionId: 'session-1' })
    off()

    expect(received).toEqual([{ sessionId: 'session-1' }])
  })

  it('rejects events outside the generated contract', () => {
    expect(() => {
      serverEventBus.emit('session.legacy.created' as never, {})
    }).toThrow('Unknown event bus event')
  })
})
