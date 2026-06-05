import type { Tool, ToolPermissionContext, Tools } from '../../Tool.js'

/**
 * Beya Server is a headless product surface. Customer tools are loaded through
 * plugins, MCP, or remote executors; CLI/TUI tool UI modules are intentionally
 * excluded from the blackbox server bundle.
 */
export function getHeadlessBuiltInTools(
  _toolPermissionContext?: ToolPermissionContext,
): Tools {
  return []
}

export type HeadlessBuiltInTool = Tool
