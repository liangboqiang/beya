import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'

export type JsonObject = Record<string, unknown>

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

export type ServerToolRuntimeEvent =
  | {
      type: 'APPROVAL_REQUESTED'
      task_id: string
      workflow_id: string
      session_id: string
      message: string
      payload: JsonObject
    }
