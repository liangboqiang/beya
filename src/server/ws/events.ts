/**
 * WebSocket event type definitions
 *
 * 定义客户端与服务器之间 WebSocket 通信的消息类型。
 */

// ============================================================================
// Client → Server
// ============================================================================

export type ClientMessage =
  | { type: 'session.prewarm' }
  | {
      type: 'session.message.send'
      content: string
      attachments?: AttachmentRef[]
      metadata?: Record<string, unknown>
    }
  | {
      type: 'session.permission.respond'
      requestId: string
      allowed: boolean
      rule?: string
      updatedInput?: Record<string, unknown>
      feedback?: string
      contentBlocks?: unknown[]
    }
  | {
      type: 'session.computeruse.permission.respond'
      requestId: string
      response: ComputerUsePermissionResponse
    }
  | { type: 'session.permission.mode.set'; mode: string }
  | {
      type: 'session.runtime.select'
      kind?: 'provider' | 'local_cli'
      providerId: string | null
      localCliId?: string | null
      modelId: string
      effortLevel?: string
    }
  | { type: 'session.generation.stop' }
  | { type: 'session.ping' }

export type AttachmentRef = {
  type: 'file' | 'image'
  name?: string
  path?: string
  data?: string // base64 for images
  mimeType?: string
  isDirectory?: boolean
}

// ============================================================================
// Server → Client
// ============================================================================

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

// ============================================================================
// Internal types
// ============================================================================

export type WebSocketSession = {
  sessionId: string
  connectedAt: number
  abortController?: AbortController
  isGenerating: boolean
}
