import {
  isEventBusEvent,
  type EventBusEvent,
  type JsonObject,
} from '../../generated/contracts/index.js'

export type ServerEventBusPayload = JsonObject & {
  sessionId?: string
}

export type ServerEventBusHandler<TPayload extends ServerEventBusPayload = ServerEventBusPayload> = (
  payload: TPayload,
) => void | Promise<void>

class ServerEventBus {
  private handlers = new Map<EventBusEvent, Set<ServerEventBusHandler>>()

  on(event: EventBusEvent, handler: ServerEventBusHandler): () => void {
    const handlers = this.handlers.get(event) ?? new Set<ServerEventBusHandler>()
    handlers.add(handler)
    this.handlers.set(event, handlers)
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.handlers.delete(event)
      }
    }
  }

  emit(event: EventBusEvent, payload: ServerEventBusPayload = {}): void {
    if (!isEventBusEvent(event)) {
      throw new Error(`Unknown event bus event: ${event}`)
    }
    for (const handler of this.handlers.get(event) ?? []) {
      void Promise.resolve(handler(payload)).catch((error) => {
        console.error(`[event-bus] handler failed for ${event}:`, error)
      })
    }
  }
}

export const serverEventBus = new ServerEventBus()
