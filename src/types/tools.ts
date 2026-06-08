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
export type AgentToolProgress = any
export type BashProgress = any
export type MCPProgress = any
export type PowerShellProgress = any
export type REPLToolProgress = any
export type SdkWorkflowProgress = any
export type ShellProgress = any
export type SkillToolProgress = any
export type TaskOutputProgress = any
export type ToolProgressData = any
export type WebSearchProgress = any

export { stub as AgentToolProgress, stub as BashProgress, stub as MCPProgress, stub as PowerShellProgress, stub as REPLToolProgress, stub as SdkWorkflowProgress, stub as ShellProgress, stub as SkillToolProgress, stub as TaskOutputProgress, stub as ToolProgressData, stub as WebSearchProgress }
