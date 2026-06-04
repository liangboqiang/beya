import { mkdir, appendFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getBeyaConfigHomeDir } from '../utils/envUtils.js'
import { GatewayTaskRunner } from './taskRunner.js'
import type {
  GatewayTaskEvent,
  GatewayTaskRequest,
  JsonObject,
  TaskRecord,
} from './types.js'

type TaskSubscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>
  types?: Set<string>
}

const encoder = new TextEncoder()

export class GatewayTaskService {
  private readonly runner = new GatewayTaskRunner()
  private readonly tasks = new Map<string, TaskRecord>()
  private readonly events = new Map<string, GatewayTaskEvent[]>()
  private readonly subscribers = new Map<string, Set<TaskSubscriber>>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly eventLogPath = join(
    getBeyaConfigHomeDir(),
    'gateway',
    'task-events.jsonl',
  )

  async submit(input: GatewayTaskRequest): Promise<TaskRecord> {
    const taskId = input.taskId ?? randomUUID()
    const createdAt = new Date().toISOString()
    const task: TaskRecord = {
      task_id: taskId,
      workflow_id: taskId,
      session_id: input.sessionId,
      query: input.query,
      status: 'QUEUED',
      created_at: createdAt,
      updated_at: createdAt,
      model_used: input.model,
      provider: typeof input.provider === 'string'
        ? input.provider
        : input.provider?.id,
      metadata: input.metadata ?? input.context,
    }
    this.tasks.set(taskId, task)
    this.events.set(taskId, [])

    const abortController = new AbortController()
    this.controllers.set(taskId, abortController)
    void this.runTask(taskId, input, abortController).catch(error => {
      this.failTask(taskId, error)
    })

    return task
  }

  list(options: {
    limit?: number
    offset?: number
    status?: string
    sessionId?: string
  } = {}): { tasks: TaskRecord[]; total_count: number } {
    let tasks = [...this.tasks.values()]
    if (options.status) {
      tasks = tasks.filter(task => task.status === options.status)
    }
    if (options.sessionId) {
      tasks = tasks.filter(task => task.session_id === options.sessionId)
    }
    tasks.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    const total = tasks.length
    const offset = options.offset ?? 0
    const limit = options.limit ?? 50
    return {
      tasks: tasks.slice(offset, offset + limit),
      total_count: total,
    }
  }

  get(taskId: string): TaskRecord | null {
    return this.tasks.get(taskId) ?? null
  }

  getEvents(taskId: string, options: {
    lastEventId?: string | null
    types?: string[]
  } = {}): GatewayTaskEvent[] {
    const events = this.events.get(taskId) ?? []
    const start = options.lastEventId
      ? events.findIndex(event => event.stream_id === options.lastEventId) + 1
      : 0
    const typeFilter = options.types?.length ? new Set(options.types) : null
    return events
      .slice(Math.max(start, 0))
      .filter(event => !typeFilter || typeFilter.has(event.type))
  }

  cancel(taskId: string, reason = 'cancelled'): boolean {
    const controller = this.controllers.get(taskId)
    const task = this.tasks.get(taskId)
    if (!controller || !task) return false
    controller.abort(reason)
    task.status = 'CANCELLED'
    task.updated_at = new Date().toISOString()
    task.completed_at = task.updated_at
    this.appendEvent(taskId, {
      type: 'WORKFLOW_CANCELLED',
      task_id: taskId,
      workflow_id: taskId,
      session_id: task.session_id ?? '',
      message: reason,
    })
    return true
  }

  stream(taskId: string, options: {
    lastEventId?: string | null
    types?: string[]
  } = {}): ReadableStream<Uint8Array> {
    let subscriber: TaskSubscriber | null = null
    return new ReadableStream<Uint8Array>({
      start: controller => {
        for (const event of this.getEvents(taskId, options)) {
          controller.enqueue(encoder.encode(formatSseEvent(event)))
        }

        const task = this.tasks.get(taskId)
        if (!task || isTerminal(task.status)) {
          controller.close()
          return
        }

        subscriber = {
          controller,
          types: options.types?.length ? new Set(options.types) : undefined,
        }
        let set = this.subscribers.get(taskId)
        if (!set) {
          set = new Set()
          this.subscribers.set(taskId, set)
        }
        set.add(subscriber)
      },
      cancel: () => {
        if (!subscriber) return
        const set = this.subscribers.get(taskId)
        if (!set) return
        set.delete(subscriber)
        if (set.size === 0) {
          this.subscribers.delete(taskId)
        }
      },
    })
  }

  private async runTask(
    taskId: string,
    input: GatewayTaskRequest,
    abortController: AbortController,
  ): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'RUNNING'
    task.updated_at = new Date().toISOString()

    for await (const event of this.runner.stream(
      { ...input, taskId },
      { signal: abortController.signal },
    )) {
      const stored = this.appendEvent(taskId, event)
      task.session_id = stored.session_id
      task.updated_at = stored.timestamp
      if (stored.type === 'WORKFLOW_COMPLETED') {
        task.status = 'COMPLETED'
        task.completed_at = stored.timestamp
        task.result = stored.result
      } else if (stored.type === 'WORKFLOW_FAILED') {
        task.status = 'FAILED'
        task.completed_at = stored.timestamp
        task.error_message = stored.error
      } else if (stored.type === 'WORKFLOW_CANCELLED') {
        task.status = 'CANCELLED'
        task.completed_at = stored.timestamp
      }
    }

    const current = this.tasks.get(taskId)
    if (current && current.status === 'RUNNING') {
      current.status = 'COMPLETED'
      current.completed_at = new Date().toISOString()
      current.updated_at = current.completed_at
    }
    this.controllers.delete(taskId)
    this.closeSubscribers(taskId)
  }

  private failTask(taskId: string, error: unknown): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    const message = error instanceof Error ? error.message : String(error)
    task.status = 'FAILED'
    task.updated_at = new Date().toISOString()
    task.completed_at = task.updated_at
    task.error_message = message
    this.appendEvent(taskId, {
      type: 'WORKFLOW_FAILED',
      task_id: taskId,
      workflow_id: taskId,
      session_id: task.session_id ?? '',
      message,
      error: message,
    })
    this.controllers.delete(taskId)
    this.closeSubscribers(taskId)
  }

  private appendEvent(
    taskId: string,
    event: Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>,
  ): GatewayTaskEvent {
    const events = this.events.get(taskId) ?? []
    const seq = events.length + 1
    const timestamp = new Date().toISOString()
    const stored = {
      ...event,
      timestamp,
      seq,
      stream_id: `${Date.now()}-${seq}`,
    } as GatewayTaskEvent
    events.push(stored)
    this.events.set(taskId, events)
    void this.persistEvent(stored)
    this.publishEvent(taskId, stored)
    return stored
  }

  private publishEvent(taskId: string, event: GatewayTaskEvent): void {
    const set = this.subscribers.get(taskId)
    if (!set) return
    for (const subscriber of [...set]) {
      if (subscriber.types && !subscriber.types.has(event.type)) continue
      try {
        subscriber.controller.enqueue(encoder.encode(formatSseEvent(event)))
      } catch {
        set.delete(subscriber)
      }
    }
    if (event.type === 'done' || event.type === 'WORKFLOW_COMPLETED' || event.type === 'WORKFLOW_FAILED' || event.type === 'WORKFLOW_CANCELLED') {
      this.closeSubscribers(taskId)
    }
  }

  private closeSubscribers(taskId: string): void {
    const set = this.subscribers.get(taskId)
    if (!set) return
    this.subscribers.delete(taskId)
    for (const subscriber of set) {
      try {
        subscriber.controller.close()
      } catch {
        // Already closed.
      }
    }
  }

  private async persistEvent(event: GatewayTaskEvent): Promise<void> {
    await mkdir(join(getBeyaConfigHomeDir(), 'gateway'), { recursive: true })
    await appendFile(this.eventLogPath, `${JSON.stringify(event)}\n`, 'utf-8')
  }
}

export const gatewayTaskService = new GatewayTaskService()

export function formatSseEvent(event: GatewayTaskEvent): string {
  return [
    `id: ${event.stream_id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n')
}

function isTerminal(status: string): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED'
}
