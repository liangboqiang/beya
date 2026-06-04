import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { QueryDeps } from '../query/deps.js'

export type JsonObject = Record<string, unknown>

export type GatewayProviderRef =
  | string
  | {
      id: string
      name?: string
    }

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'plan'

export type PermissionRequest = {
  taskId: string
  sessionId: string
  toolCallId: string
  toolName: string
  input: JsonObject
  reason: string
}

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: JsonObject }
  | { behavior: 'deny'; reason?: string }

export type PermissionHandler = (
  request: PermissionRequest,
) => Promise<PermissionDecision>

export type ToolCallExtra = {
  taskId: string
  sessionId: string
  toolCallId: string
  signal: AbortSignal
  metadata?: JsonObject
}

export type RemoteToolExecutor = {
  type: 'http'
  url: string
  method?: 'POST'
  headers?: Record<string, string>
  toolName?: string
  namespace?: string
}

export type ToolDefinition = {
  name: string
  description: string
  inputSchema?: JsonObject
  execute?: (
    args: JsonObject,
    extra: ToolCallExtra,
  ) => Promise<CallToolResult>
  executor?: RemoteToolExecutor
  annotations?: ToolAnnotations
  searchHint?: string
  alwaysLoad?: boolean
}

export type SkillDefinition = {
  name: string
  description: string
  content: string
  whenToUse?: string
  allowedTools?: string[]
  argumentHint?: string
  model?: string
  userInvocable?: boolean
}

export type PluginDefinition = {
  name: string
  description?: string
  agents?: string[]
  skills?: Array<string | SkillDefinition>
  tools?: Array<ToolDefinition>
  mcpServers?: JsonObject
  hooks?: JsonObject
  resources?: string[]
}

export type PluginRef =
  | string
  | { type: 'local'; path: string }
  | { type: 'inline'; definition: PluginDefinition }

export type GatewayTaskRequest = {
  query: string
  sessionId?: string
  taskId?: string
  agent?: string
  instructions?: string
  model?: string
  provider?: GatewayProviderRef
  mode?: string
  context?: JsonObject
  metadata?: JsonObject
  maxTurns?: number
  skills?: Array<string | SkillDefinition>
  plugins?: PluginRef[]
  permissionMode?: PermissionMode
  permissionHandler?: PermissionHandler
  tools?: ToolDefinition[]
}

export type NormalizedTaskRequest = {
  query: string
  sessionId?: string
  taskId: string
  agent: string
  instructions?: string
  model?: string
  provider?: GatewayProviderRef
  maxTurns?: number
  metadata?: JsonObject
  skills: Array<string | SkillDefinition>
  plugins: PluginRef[]
  permissionMode: PermissionMode
  permissionHandler?: PermissionHandler
  tools: ToolDefinition[]
  signal?: AbortSignal
}

export type GatewayTaskEvent =
  | {
      type: 'TASK_STARTED'
      task_id: string
      workflow_id: string
      session_id: string
      agent: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
    }
  | {
      type: 'LLM_PARTIAL'
      task_id: string
      workflow_id: string
      session_id: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
    }
  | {
      type: 'AGENT_THINKING'
      task_id: string
      workflow_id: string
      session_id: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
    }
  | {
      type: 'TOOL_INVOKED'
      task_id: string
      workflow_id: string
      session_id: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
      payload: JsonObject
    }
  | {
      type: 'TOOL_OBSERVATION'
      task_id: string
      workflow_id: string
      session_id: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
      payload: JsonObject
    }
  | {
      type: 'APPROVAL_REQUESTED'
      task_id: string
      workflow_id: string
      session_id: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
      payload: JsonObject
    }
  | {
      type: 'WORKFLOW_COMPLETED'
      task_id: string
      workflow_id: string
      session_id: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
      result: string
    }
  | {
      type: 'WORKFLOW_FAILED'
      task_id: string
      workflow_id: string
      session_id: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
      error: string
    }
  | {
      type: 'WORKFLOW_CANCELLED'
      task_id: string
      workflow_id: string
      session_id: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
    }
  | {
      type: 'done'
      task_id: string
      workflow_id: string
      session_id: string
      timestamp: string
      seq: number
      stream_id: string
      message: string
    }

export type TaskStatusValue =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export type TaskRecord = {
  task_id: string
  workflow_id: string
  session_id?: string
  query: string
  status: TaskStatusValue
  created_at: string
  updated_at: string
  completed_at?: string
  result?: string
  error_message?: string
  model_used?: string
  provider?: string
  metadata?: JsonObject
}

export type ResolvedModelTransport = {
  deps: QueryDeps
  model: string
  providerId?: string
}
