import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
  type Tools,
} from '../../Tool.js'
import { loadRuntimePluginToolDefinitions } from '../../services/runtimePluginTools.js'
import { getTools } from '../../tools.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import {
  isExecutableToolDefinition,
  toolDefinitionToBeyaTool,
} from './beyaToolDefinitions.js'
import type { ToolDefinition } from '../types/serverRuntime.js'

export type RuntimeToolInfo = {
  name: string
  description: string
  parameters: Record<string, unknown>
  read_only: boolean
  destructive: boolean
  open_world: boolean
  native: boolean
  plugin: boolean
  executable: boolean
  requires_user_interaction: boolean
  should_defer: boolean
  always_load: boolean
}

export type SessionRuntimeSurface = {
  toolPermissionContext: ToolPermissionContext
  nativeTools: Tools
  pluginToolDefinitions: ToolDefinition[]
  pluginTools: Tools
  tools: Tools
}

export async function loadSessionRuntimeSurface(options: {
  sessionId?: string
  cwd?: string
  metadata?: Record<string, unknown>
  permissionContext?: ToolPermissionContext
} = {}): Promise<SessionRuntimeSurface> {
  const toolPermissionContext =
    options.permissionContext ?? getEmptyToolPermissionContext()
  const nativeTools = getTools(toolPermissionContext)
  const pluginToolDefinitions = await loadRuntimePluginToolDefinitions()
  const pluginTools = pluginToolDefinitions.map(definition =>
    toolDefinitionToBeyaTool(definition, {
      taskId: options.sessionId ?? 'beya-server-tools',
      sessionId: options.sessionId ?? 'beya-server-tools',
      signal: new AbortController().signal,
      metadata: options.metadata ?? {},
    }),
  )

  return {
    toolPermissionContext,
    nativeTools,
    pluginToolDefinitions,
    pluginTools,
    tools: dedupeTools([...nativeTools, ...pluginTools]),
  }
}

export async function runtimeToolInfo(
  tool: Tool,
  surface: Pick<SessionRuntimeSurface, 'tools' | 'toolPermissionContext' | 'pluginToolDefinitions'>,
): Promise<RuntimeToolInfo> {
  const pluginDefinition = surface.pluginToolDefinitions.find(
    definition => definition.name === tool.name,
  )
  const emptyInput = {}
  const description = pluginDefinition?.description ??
    await tool.description(emptyInput, {
      isNonInteractiveSession: true,
      toolPermissionContext: surface.toolPermissionContext,
      tools: surface.tools,
    })

  return {
    name: tool.name,
    description,
    parameters: tool.inputJSONSchema ??
      (zodToJsonSchema(tool.inputSchema) as Record<string, unknown>),
    read_only: toolFlag(tool, 'isReadOnly'),
    destructive: toolFlag(tool, 'isDestructive'),
    open_world: toolFlag(tool, 'isOpenWorld'),
    native: !pluginDefinition,
    plugin: Boolean(pluginDefinition),
    executable: pluginDefinition
      ? isExecutableToolDefinition(pluginDefinition)
      : true,
    requires_user_interaction: tool.requiresUserInteraction?.() === true,
    should_defer: tool.shouldDefer === true,
    always_load: tool.alwaysLoad === true,
  }
}

function dedupeTools(tools: Tools): Tools {
  const seen = new Set<string>()
  const out: Tool[] = []
  for (const tool of tools) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    out.push(tool)
  }
  return out
}

function toolFlag(
  tool: Tool,
  key: 'isReadOnly' | 'isDestructive' | 'isOpenWorld',
): boolean {
  const fn = tool[key]
  if (typeof fn !== 'function') return false
  try {
    return Boolean(fn.call(tool, {}))
  } catch {
    return false
  }
}
