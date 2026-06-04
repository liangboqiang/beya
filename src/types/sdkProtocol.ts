/**
 * Shared SDK protocol types used by Beya internals.
 *
 * This module is intentionally type/protocol-only. Public SDK packages are
 * Gateway clients; no in-process runtime stubs are exported from here.
 */

export type {
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
export * from '../entrypoints/sdk/coreTypes.js'
export * from '../entrypoints/sdk/runtimeTypes.js'
export type { Settings } from '../entrypoints/sdk/settingsTypes.generated.js'
export * from '../entrypoints/sdk/toolTypes.js'
