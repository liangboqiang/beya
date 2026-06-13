import type { PermissionMode } from './settings'
import type { RuntimeSelection } from './runtime'

// Source: src/server/ws/events.ts

// ─── Client → Server ──────────────────────────────────────────────

export type ClientMessage =
  | { type: 'session.prewarm' }
  | { type: 'session.message.send'; content: string; attachments?: AttachmentRef[] }
  | {
      type: 'session.permission.respond'
      requestId: string
      allowed: boolean
      rule?: string
      updatedInput?: Record<string, unknown>
    }
  | {
      type: 'session.computeruse.permission.respond'
      requestId: string
      response: ComputerUsePermissionResponse
    }
  | { type: 'session.permission.mode.set'; mode: PermissionMode }
  | ({ type: 'session.runtime.select' } & RuntimeSelection)
  | { type: 'session.generation.stop' }
  | { type: 'session.ping' }

export type AttachmentRef = {
  type: 'file' | 'image'
  name?: string
  path?: string
  data?: string
  mimeType?: string
  isDirectory?: boolean
  lineStart?: number
  lineEnd?: number
  note?: string
  quote?: string
}

export type UIAttachment = {
  type: 'file' | 'image'
  name: string
  path?: string
  data?: string
  mimeType?: string
  isDirectory?: boolean
  lineStart?: number
  lineEnd?: number
  note?: string
  quote?: string
}

// ─── Server → Client ──────────────────────────────────────────────

export type ServerMessage =
  | { type: 'session.connected'; sessionId: string }
  | { type: 'session.message.started'; blockType: 'text' | 'tool_use'; toolName?: string; toolUseId?: string; parentToolUseId?: string }
  | { type: 'session.message.delta'; text?: string; toolInput?: string }
  | { type: 'session.tool.completed'; toolName: string; toolUseId: string; input: unknown; parentToolUseId?: string }
  | { type: 'session.tool.result'; toolUseId: string; content: unknown; isError: boolean; parentToolUseId?: string }
  | {
      type: 'session.permission.requested'
      requestId: string
      toolName: string
      toolUseId?: string
      input: unknown
      description?: string
    }
  | {
      type: 'session.computeruse.permission.requested'
      requestId: string
      request: ComputerUsePermissionRequest
    }
  | { type: 'session.completed'; usage: TokenUsage }
  | { type: 'session.thinking.delta'; text: string }
  | { type: 'session.status.changed'; state: ChatState; verb?: string; elapsed?: number; tokens?: number }
  | {
      type: 'session.api.retry'
      attempt: number
      maxRetries: number
      retryDelayMs: number
      errorStatus: number | null
      errorType?: string
      errorMessage?: string
    }
  | { type: 'session.failed'; message: string; code: string; retryable?: boolean; businessErrorCode?: string }
  | { type: 'session.system.notification'; subtype: string; message?: string; data?: unknown }
  | { type: 'session.pong' }
  | { type: 'session.team.updated'; teamName: string; members: TeamMemberStatus[] }
  | { type: 'session.team.created'; teamName: string }
  | { type: 'session.team.deleted'; teamName: string }
  | { type: 'session.task.updated'; taskId: string; status: string; progress?: string }
  | { type: 'session.title.updated'; sessionId: string; title: string }

export type TokenUsage = {
  status?: 'actual' | 'estimated' | 'unavailable'
  source?: 'provider' | 'local_cli' | 'transcript_estimate' | 'none'
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
}

export type ChatState = 'idle' | 'thinking' | 'compacting' | 'tool_executing' | 'streaming' | 'permission_pending'

export type ApiRetryState = {
  attempt: number
  maxRetries: number
  retryDelayMs: number
  errorStatus: number | null
  errorType?: string
  errorMessage?: string
  receivedAt: number
}

export type TeamMemberStatus = {
  agentId: string
  role: string
  status: 'running' | 'idle' | 'completed' | 'error'
  currentTask?: string
}

export type ComputerUseGrantFlags = {
  clipboardRead: boolean
  clipboardWrite: boolean
  systemKeyCombos: boolean
}

export type ComputerUseResolvedApp = {
  bundleId: string
  displayName: string
  path?: string
  iconDataUrl?: string
}

export type ComputerUseResolvedAppRequest = {
  requestedName: string
  resolved?: ComputerUseResolvedApp
  isSentinel: boolean
  alreadyGranted: boolean
  proposedTier: 'read' | 'click' | 'full'
}

export type ComputerUsePermissionRequest = {
  requestId: string
  reason: string
  apps: ComputerUseResolvedAppRequest[]
  requestedFlags: Partial<ComputerUseGrantFlags>
  screenshotFiltering: 'native' | 'none'
  tccState?: {
    accessibility: boolean
    screenRecording: boolean
  }
  willHide?: Array<{ bundleId: string; displayName: string }>
  autoUnhideEnabled?: boolean
}

export type ComputerUsePermissionResponse = {
  granted: Array<{
    bundleId: string
    displayName: string
    grantedAt: number
    tier?: 'read' | 'click' | 'full'
  }>
  denied: Array<{
    bundleId: string
    reason: 'user_denied' | 'not_installed'
  }>
  flags: ComputerUseGrantFlags
  userConsented?: boolean
}

export type AgentTaskNotification = {
  taskId: string
  toolUseId: string
  status: 'completed' | 'failed' | 'stopped'
  summary?: string
  result?: string
  outputFile?: string
  usage?: BackgroundAgentTaskUsage
  timestamp?: string
}

export type BackgroundAgentTaskUsage = {
  totalTokens?: number
  toolUses?: number
  durationMs?: number
}

export type BackgroundAgentTask = {
  taskId: string
  toolUseId?: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  description?: string
  taskType?: string
  workflowName?: string
  prompt?: string
  summary?: string
  lastToolName?: string
  outputFile?: string
  usage?: BackgroundAgentTaskUsage
  startedAt: number
  updatedAt: number
}

export type MemoryEventFile = {
  path: string
  action?: 'saved' | 'updated' | 'created' | 'deleted' | 'loaded' | 'failed'
  summary?: string
}

export type GoalEventAction = 'created' | 'replaced' | 'status' | 'paused' | 'resumed' | 'completed' | 'cleared' | 'message'

export type ActiveGoalState = {
  action: Exclude<GoalEventAction, 'cleared' | 'message'>
  status?: string
  objective?: string
  budget?: string
  elapsed?: string
  continuations?: string
  message?: string
  updatedAt: number
}

// ─── UI Message model (rendered in MessageList) ───────────────────

export type TaskSummaryItem = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export type UIMessage =
  | { id: string; type: 'user_text'; content: string; modelContent?: string; transcriptMessageId?: string; timestamp: number; attachments?: UIAttachment[]; pending?: boolean }
  | { id: string; type: 'assistant_text'; content: string; transcriptMessageId?: string; timestamp: number; model?: string }
  | { id: string; type: 'thinking'; content: string; timestamp: number }
  | {
      id: string
      type: 'tool_use'
      toolName: string
      toolUseId: string
      input: unknown
      timestamp: number
      parentToolUseId?: string
      isPending?: boolean
      partialInput?: string
    }
  | { id: string; type: 'tool_result'; toolUseId: string; content: unknown; isError: boolean; timestamp: number; parentToolUseId?: string }
  | { id: string; type: 'background_task'; task: BackgroundAgentTask; timestamp: number }
  | { id: string; type: 'system'; content: string; timestamp: number }
  | {
      id: string
      type: 'compact_summary'
      title: string
      phase?: 'compacting' | 'complete'
      summary?: string
      trigger?: 'manual' | 'auto'
      preTokens?: number
      messagesSummarized?: number
      timestamp: number
    }
  | {
      id: string
      type: 'goal_event'
      action: GoalEventAction
      status?: string
      objective?: string
      budget?: string
      elapsed?: string
      continuations?: string
      message?: string
      timestamp: number
    }
  | {
      id: string
      type: 'memory_event'
      event: 'saved' | 'updated' | 'loaded' | 'failed'
      files: MemoryEventFile[]
      message?: string
      teamCount?: number
      timestamp: number
    }
  | {
      id: string
      type: 'permission_prompt'
      requestId: string
      toolName: string
      toolUseId?: string
      input: unknown
      description?: string
      timestamp: number
    }
  | { id: string; type: 'error'; message: string; code: string; businessErrorCode?: string; timestamp: number }
  | { id: string; type: 'task_summary'; tasks: TaskSummaryItem[]; timestamp: number }
