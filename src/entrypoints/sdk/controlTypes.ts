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
export type SDKControlCancelRequest = any
export type SDKControlInitializeRequest = any
export type SDKControlInitializeResponse = any
export type SDKControlMcpSetServersResponse = any
export type SDKControlPermissionRequest = any
export type SDKControlReloadPluginsResponse = any
export type SDKControlRequest = any
export type SDKControlRequestInner = any
export type SDKControlResponse = any
export type SDKPartialAssistantMessage = any
export type StdinMessage = any
export type StdoutMessage = any

export { stub as SDKControlCancelRequest, stub as SDKControlInitializeRequest, stub as SDKControlInitializeResponse, stub as SDKControlMcpSetServersResponse, stub as SDKControlPermissionRequest, stub as SDKControlReloadPluginsResponse, stub as SDKControlRequest, stub as SDKControlRequestInner, stub as SDKControlResponse, stub as SDKPartialAssistantMessage, stub as StdinMessage, stub as StdoutMessage }
