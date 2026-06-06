import { toolDefinitionToBeyaTool } from 'src/server/services/beyaToolDefinitions.js'
import { loadInstalledBeyaPlugins } from 'src/server/services/beyaPluginRuntime.js'
import type { ToolDefinition } from 'src/server/types/serverRuntime.js'
import type { Tools } from 'src/Tool.js'

export function parseRuntimeMetadata(
  raw: string | undefined = process.env.BEYA_RUNTIME_METADATA_JSON,
): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function loadRuntimePluginToolDefinitions(): Promise<ToolDefinition[]> {
  const plugins = await loadInstalledBeyaPlugins()
  return plugins.flatMap(plugin => plugin.tools)
}

export async function loadRuntimePluginTools(options: {
  sessionId: string
  metadata?: Record<string, unknown>
}): Promise<Tools> {
  const abortController = new AbortController()
  const definitions = await loadRuntimePluginToolDefinitions()
  return definitions.map(definition =>
    toolDefinitionToBeyaTool(definition, {
      taskId: options.sessionId,
      sessionId: options.sessionId,
      signal: abortController.signal,
      metadata: options.metadata ?? {},
    }),
  )
}
