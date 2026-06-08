// @generated stub from scan-missing-imports (runtime-safe)
// This module is intentionally a no-op compatibility shim.
// It exports every name that the public source tree imports from it so ESM startup
// does not fail when optional/internal modules are absent.

const __target = function noop(..._args: any[]) {
  return undefined
}

const __handler: ProxyHandler<any> = {
  get(_target, prop) {
    if (prop === '__esModule') return true
    if (prop === 'default') return stub
    if (prop === Symbol.toPrimitive) return () => undefined
    if (prop === Symbol.iterator) return function* () {}
    if (prop === Symbol.asyncIterator) return async function* () {}
    if (prop === 'then') return undefined
    return stub
  },
  apply() {
    return stub
  },
  construct() {
    return stub
  },
}

const stub: any = new Proxy(__target, __handler)

export default stub
export const __stubMissing = true
export type AssistantMessage = any
export type AttachmentMessage = any
export type CollapsedReadSearchGroup = any
export type CollapsibleMessage = any
export type CompactMetadata = any
export type GroupedToolUseMessage = any
export type HookResultMessage = any
export type Message = any
export type MessageOrigin = any
export type NormalizedAssistantMessage = any
export type NormalizedMessage = any
export type NormalizedUserMessage = any
export type PartialCompactDirection = any
export type ProgressMessage = any
export type RenderableMessage = any
export type RequestStartEvent = any
export type StopHookInfo = any
export type StreamEvent = any
export type SystemAPIErrorMessage = any
export type SystemAgentsKilledMessage = any
export type SystemApiMetricsMessage = any
export type SystemAwaySummaryMessage = any
export type SystemBridgeStatusMessage = any
export type SystemCompactBoundaryMessage = any
export type SystemFileSnapshotMessage = any
export type SystemInformationalMessage = any
export type SystemLocalCommandMessage = any
export type SystemMemorySavedMessage = any
export type SystemMessage = any
export type SystemMessageLevel = any
export type SystemMicrocompactBoundaryMessage = any
export type SystemPermissionRetryMessage = any
export type SystemScheduledTaskFireMessage = any
export type SystemStopHookSummaryMessage = any
export type SystemThinkingMessage = any
export type SystemTurnDurationMessage = any
export type TombstoneMessage = any
export type ToolUseSummaryMessage = any
export type UserMessage = any

export { stub as AssistantMessage, stub as AttachmentMessage, stub as CollapsedReadSearchGroup, stub as CollapsibleMessage, stub as CompactMetadata, stub as GroupedToolUseMessage, stub as HookResultMessage, stub as Message, stub as MessageOrigin, stub as NormalizedAssistantMessage, stub as NormalizedMessage, stub as NormalizedUserMessage, stub as PartialCompactDirection, stub as ProgressMessage, stub as RenderableMessage, stub as RequestStartEvent, stub as StopHookInfo, stub as StreamEvent, stub as SystemAPIErrorMessage, stub as SystemAgentsKilledMessage, stub as SystemApiMetricsMessage, stub as SystemAwaySummaryMessage, stub as SystemBridgeStatusMessage, stub as SystemCompactBoundaryMessage, stub as SystemFileSnapshotMessage, stub as SystemInformationalMessage, stub as SystemLocalCommandMessage, stub as SystemMemorySavedMessage, stub as SystemMessage, stub as SystemMessageLevel, stub as SystemMicrocompactBoundaryMessage, stub as SystemPermissionRetryMessage, stub as SystemScheduledTaskFireMessage, stub as SystemStopHookSummaryMessage, stub as SystemThinkingMessage, stub as SystemTurnDurationMessage, stub as TombstoneMessage, stub as ToolUseSummaryMessage, stub as UserMessage }
