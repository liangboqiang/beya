// SDK Core Types - Common serializable types used by both SDK consumers and SDK builders.
//
// Types are generated from Zod schemas in coreSchemas.ts.
// To modify types:
// 1. Edit Zod schemas in coreSchemas.ts
// 2. Run: bun scripts/generate-sdk-types.ts
//
// Schemas are available in coreSchemas.ts for runtime validation but are not
// part of the public API.

// Re-export sandbox types for SDK consumers
import type { z } from 'zod/v4'
import type {
  AgentDefinitionSchema,
  AgentInfoSchema,
  FastModeStateSchema,
  HookEventSchema,
  HookInputSchema,
  HookJSONOutputSchema,
  McpServerConfigForProcessTransportSchema,
  McpServerStatusSchema,
  ModelInfoSchema,
  ModelUsageSchema,
  PermissionModeSchema,
  PermissionResultSchema,
  RewindFilesResultSchema,
  SDKAssistantMessageErrorSchema,
  SDKAssistantMessageSchema,
  SDKMessageSchema,
  SDKResultMessageSchema,
  SDKSessionInfoSchema,
  SDKStatusSchema,
  SDKUserMessageReplaySchema,
  SDKUserMessageSchema,
  ExitReasonSchema,
} from './coreSchemas.js'

export type {
  SandboxFilesystemConfig,
  SandboxIgnoreViolations,
  SandboxNetworkConfig,
  SandboxSettings,
} from '../sandboxTypes.js'
// Re-export all generated types
export * from './coreTypes.generated.js'

// Re-export utility types that can't be expressed as Zod schemas
export type { NonNullableUsage } from './sdkUtilityTypes.js'

// Const arrays for runtime usage
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const

export const EXIT_REASONS = [
  'clear',
  'resume',
  'logout',
  'prompt_input_exit',
  'other',
  'bypass_permissions_disabled',
] as const

type InferSchema<T extends (...args: never[]) => z.ZodType> = z.infer<
  ReturnType<T>
>

export type ModelUsage = InferSchema<typeof ModelUsageSchema>
export type McpServerConfigForProcessTransport = InferSchema<
  typeof McpServerConfigForProcessTransportSchema
>
export type McpServerStatus = InferSchema<typeof McpServerStatusSchema>
export type PermissionResult = InferSchema<typeof PermissionResultSchema>
export type PermissionMode = InferSchema<typeof PermissionModeSchema>
export type HookEvent = InferSchema<typeof HookEventSchema>
export type HookInput = InferSchema<typeof HookInputSchema>
export type HookJSONOutput = InferSchema<typeof HookJSONOutputSchema>
export type ExitReason = InferSchema<typeof ExitReasonSchema>
export type AgentInfo = InferSchema<typeof AgentInfoSchema>
export type AgentDefinition = InferSchema<typeof AgentDefinitionSchema>
export type ModelInfo = InferSchema<typeof ModelInfoSchema>
export type RewindFilesResult = InferSchema<typeof RewindFilesResultSchema>
export type SDKAssistantMessageError = InferSchema<
  typeof SDKAssistantMessageErrorSchema
>
export type SDKStatus = InferSchema<typeof SDKStatusSchema>
export type SDKUserMessage = InferSchema<typeof SDKUserMessageSchema>
export type SDKUserMessageReplay = InferSchema<typeof SDKUserMessageReplaySchema>
export type SDKAssistantMessage = InferSchema<typeof SDKAssistantMessageSchema>
export type SDKResultMessage = InferSchema<typeof SDKResultMessageSchema>
export type SDKSessionInfo = InferSchema<typeof SDKSessionInfoSchema>
export type SDKMessage = InferSchema<typeof SDKMessageSchema>
export type FastModeState = InferSchema<typeof FastModeStateSchema>
