import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../Tool.js'
import type {
  MCPServerConnection,
  ServerResource,
} from '../../services/mcp/types.js'
import type { Command } from '../../types/command.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import type { PermissionDecision as InternalPermissionDecision } from '../../types/permissions.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../../utils/fileStateCache.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import { shouldEnableThinkingByDefault } from '../../utils/thinking.js'
import { getHeadlessBuiltInTools } from './headlessBuiltInTools.js'
import type { PermissionHandler, PermissionMode, ServerToolRuntimeEvent } from '../types/serverRuntime.js'

type CanUseToolFn = (
  tool: Tool,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  forceDecision?: InternalPermissionDecision,
) => Promise<InternalPermissionDecision>

type HeadlessAppState = Record<string, unknown> & {
  mainLoopModel: string
  mainLoopModelForSession: string
  toolPermissionContext: ToolPermissionContext
  mcp: {
    clients: MCPServerConnection[]
    tools: Tool[]
    commands: Command[]
    resources: Record<string, ServerResource[]>
    pluginReconnectKey: number
  }
  plugins: {
    enabled: unknown[]
    disabled: unknown[]
    commands: Command[]
    errors: unknown[]
    installationStatus: {
      marketplaces: unknown[]
      plugins: unknown[]
    }
    needsRefresh: boolean
  }
}

export type HeadlessContextOptions = {
  taskId: string
  sessionId: string
  model: string
  messages: Message[]
  serverTools: Tool[]
  pluginCommands: Command[]
  mcpClients?: MCPServerConnection[]
  mcpResources?: Record<string, ServerResource[]>
  permissionMode: PermissionMode
  permissionHandler?: PermissionHandler
  abortController: AbortController
  emit: (event: ServerToolRuntimeEvent) => void
}

export function createHeadlessToolUseContext({
  model,
  messages,
  serverTools,
  pluginCommands,
  mcpClients = [],
  mcpResources = {},
  permissionMode,
  permissionHandler,
  abortController,
}: HeadlessContextOptions): ToolUseContext {
  let appState = createHeadlessAppState(
    model,
    permissionMode,
    Boolean(permissionHandler),
    pluginCommands,
  )
  const beyaTools = getHeadlessBuiltInTools(appState.toolPermissionContext)
  const tools = dedupeTools([...serverTools, ...beyaTools])
  appState = {
    ...appState,
    mcp: {
      ...appState.mcp,
      clients: mcpClients,
      tools,
      commands: pluginCommands,
      resources: mcpResources,
    },
  }

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: model,
      tools,
      verbose: false,
      thinkingConfig:
        shouldEnableThinkingByDefault() !== false
          ? { type: 'adaptive' }
          : { type: 'disabled' },
      mcpClients,
      mcpResources,
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
      querySource: 'beya_server' as never,
    },
    abortController,
    readFileState: createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE),
    getAppState: () => appState,
    setAppState: updater => {
      appState = updater(appState)
    },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages,
    nestedMemoryAttachmentTriggers: new Set(),
    loadedNestedMemoryPaths: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    contentReplacementState: undefined,
  } as ToolUseContext
}

export function createHeadlessCanUseTool({
  taskId,
  sessionId,
  permissionHandler,
  emit,
}: Pick<
  HeadlessContextOptions,
  'taskId' | 'sessionId' | 'permissionHandler' | 'emit'
>): CanUseToolFn {
  return async function canUseTool(
    tool: Tool,
    input: Record<string, unknown>,
    toolUseContext: ToolUseContext,
    assistantMessage: AssistantMessage,
    toolUseID: string,
    forceDecision?: InternalPermissionDecision,
  ) {
    if (forceDecision) return forceDecision

    const permissionResult = await hasPermissionsToUseTool(
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseID,
    )

    if (permissionResult.behavior === 'allow') return permissionResult
    if (permissionResult.behavior === 'deny') return permissionResult

    const reason =
      permissionResult.message || `Tool ${tool.name} requires permission.`
    emit({
      type: 'APPROVAL_REQUESTED',
      task_id: taskId,
      workflow_id: taskId,
      session_id: sessionId,
      message: reason,
      payload: {
        approval_id: toolUseID,
        tool_call_id: toolUseID,
        tool_name: tool.name,
        input,
      },
    })

    if (!permissionHandler) {
      return {
        behavior: 'deny',
        message: reason,
        decisionReason: { type: 'mode', mode: 'default' },
        toolUseID,
      }
    }

    const decision = await permissionHandler({
      taskId,
      sessionId,
      toolCallId: toolUseID,
      toolName: tool.name,
      input,
      reason,
    })

    if (decision.behavior === 'allow') {
      return {
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? input,
        decisionReason: {
          type: 'permissionPromptTool',
          permissionPromptToolName: 'beya-server',
          toolResult: decision,
        },
        toolUseID,
      }
    }

    return {
      behavior: 'deny',
      message: decision.reason ?? 'Tool use denied by Beya server permission handler.',
      decisionReason: {
        type: 'permissionPromptTool',
        permissionPromptToolName: 'beya-server',
        toolResult: decision,
      },
      toolUseID,
    }
  } as CanUseToolFn
}

function createHeadlessAppState(
  model: string,
  permissionMode: PermissionMode,
  hasPermissionHandler: boolean,
  pluginCommands: Command[],
): HeadlessAppState {
  return {
    mainLoopModel: model,
    mainLoopModelForSession: model,
    toolPermissionContext: {
      ...getEmptyToolPermissionContext(),
      mode: permissionMode,
      isBypassPermissionsModeAvailable:
        permissionMode === 'bypassPermissions',
      shouldAvoidPermissionPrompts: !hasPermissionHandler,
    },
    mcp: {
      clients: [],
      tools: [],
      commands: pluginCommands,
      resources: {},
      pluginReconnectKey: 0,
    },
    plugins: {
      enabled: [],
      disabled: [],
      commands: pluginCommands,
      errors: [],
      installationStatus: {
        marketplaces: [],
        plugins: [],
      },
      needsRefresh: false,
    },
    settings: {},
    tasks: {},
    agentNameRegistry: new Map(),
    agentDefinitions: { activeAgents: [], allAgents: [] },
    fileHistory: {
      snapshots: [],
      trackedFiles: new Set(),
      snapshotSequence: 0,
    },
    attribution: {
      pending: [],
      applied: [],
      skipped: [],
    },
    sessionHooks: new Map(),
    todos: {},
    notifications: { current: null, queue: [] },
    elicitation: { queue: [] },
    inbox: { messages: [] },
    workerSandboxPermissions: { queue: [], selectedIndex: 0 },
    activeOverlays: new Set<string>(),
    expandedView: 'none',
    isBriefOnly: false,
    selectedIPAgentIndex: -1,
    coordinatorTaskIndex: -1,
    viewSelectionMode: 'none',
    footerSelection: null,
    showTeammateMessagePreview: false,
    fastMode: false,
    effortValue: undefined,
    advisorModel: undefined,
  }
}

function dedupeTools(tools: readonly Tool[]): Tool[] {
  const seen = new Set<string>()
  const result: Tool[] = []
  for (const tool of tools) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    result.push(tool)
  }
  return result
}
