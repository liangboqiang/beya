import type { Tool, ToolPermissionContext, Tools } from '../Tool.js'

/**
 * Gateway is a headless product surface. Customer tools are loaded through
 * plugins, MCP, or remote executors; CLI/TUI tool UI modules are intentionally
 * excluded from the blackbox Gateway bundle.
 */
export function getGatewayBuiltInTools(
  _toolPermissionContext?: ToolPermissionContext,
): Tools {
  return []
}

export type GatewayBuiltInTool = Tool
