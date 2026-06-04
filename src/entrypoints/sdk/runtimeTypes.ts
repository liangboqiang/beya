import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod/v4'
import type {
  SDKMessage,
  SDKResultMessage,
  SDKSessionInfo,
  SDKUserMessage,
} from './coreTypes.js'
import type { PermissionMode } from '../../types/permissions.js'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'
export type AnyZodRawShape = z.ZodRawShape
export type InferShape<Schema extends AnyZodRawShape> = z.infer<
  z.ZodObject<Schema>
>

export type ToolCallExtra = {
  signal?: AbortSignal
  toolCallId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
}

export type SdkMcpToolDefinition<
  Schema extends AnyZodRawShape = AnyZodRawShape,
> = {
  name: string
  description: string
  inputSchema: Schema
  execute: (
    args: InferShape<Schema>,
    extra: ToolCallExtra,
  ) => Promise<CallToolResult>
  annotations?: ToolAnnotations
  searchHint?: string
  alwaysLoad?: boolean
}

export type SdkMcpServerInstance = {
  name: string
  version?: string
  tools: Array<SdkMcpToolDefinition<AnyZodRawShape>>
}

export type McpSdkServerConfigWithInstance = {
  type: 'sdk'
  name: string
  instance: SdkMcpServerInstance
}

export type AgentDefinitionConfig = {
  name: string
  instructions?: string
  tools?: string[]
  skills?: string[]
  plugins?: string[]
  model?: string
  metadata?: Record<string, unknown>
}

export type PermissionRequest = {
  toolName: string
  input: Record<string, unknown>
  message?: string
}

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message?: string }

export type PermissionHandler = (
  request: PermissionRequest,
) => Promise<PermissionDecision>

export type PluginConfig =
  | string
  | { type: 'local'; path: string }
  | { type: 'inline'; name: string; metadata?: Record<string, unknown> }

export type Options = {
  model?: string
  sessionId?: string
  maxTurns?: number
  signal?: AbortSignal
  tools?: Array<SdkMcpToolDefinition<AnyZodRawShape>>
  plugins?: PluginConfig[]
  permissionMode?: PermissionMode
  permissionHandler?: PermissionHandler
  useBeyaTools?: boolean
  metadata?: Record<string, unknown>
}

export type InternalOptions = Options
export type Query = AsyncGenerator<SDKMessage>
export type InternalQuery = AsyncGenerator<SDKMessage>

export type AgentInput =
  | string
  | {
      input: string
      sessionId?: string
      model?: string
      maxTurns?: number
      metadata?: Record<string, unknown>
    }

export type SDKSessionOptions = Options & {
  sessionId?: string
  dir?: string
}

export type SDKSession = {
  id: string
  run(input: string | AgentInput): Promise<SDKResultMessage>
  stream(input: string | AgentInput): AsyncGenerator<SDKMessage>
  close(): Promise<void>
}

export type SessionMessage = SDKMessage
export type ListSessionsOptions = {
  dir?: string
  limit?: number
  offset?: number
}
export type GetSessionInfoOptions = { dir?: string }
export type GetSessionMessagesOptions = GetSessionInfoOptions & {
  limit?: number
  offset?: number
  includeSystemMessages?: boolean
}
export type SessionMutationOptions = GetSessionInfoOptions
export type ForkSessionOptions = GetSessionInfoOptions & {
  upToMessageId?: string
  title?: string
}
export type ForkSessionResult = { sessionId: string }

export type RunEvent = never
export type RunOptions = Options
export type RunResult = never

export type { SDKSessionInfo, SDKUserMessage }
