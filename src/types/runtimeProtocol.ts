/**
 * Shared SDK protocol types used by Beya internals.
 *
 * This module is intentionally type/protocol-only. Public SDK packages are
 * Gateway clients; no in-process runtime stubs are exported from here.
 */

export type {
  RuntimeControlRequest,
  RuntimeControlResponse,
} from '../entrypoints/runtime/controlTypes.js'
export * from '../entrypoints/runtime/coreTypes.js'
export * from '../entrypoints/runtime/runtimeTypes.js'
export type { Settings } from '../entrypoints/runtime/settingsTypes.generated.js'
export * from '../entrypoints/runtime/toolTypes.js'
