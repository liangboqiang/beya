import { randomUUID } from 'crypto'
import { dirname } from 'path'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { query } from '../query.js'
import {
  connectHeadlessMcpServers,
  disconnectHeadlessMcpServers,
} from '../services/mcp/headlessManager.js'
import { sessionService } from '../server/services/sessionService.js'
import type { SessionLaunchInfo } from '../server/services/sessionService.js'
import { runWithScopedRuntimeState } from '../bootstrap/state.js'
import { asSessionId } from '../types/ids.js'
import type { Message } from '../types/message.js'
import { createUserMessage } from '../utils/messages.js'
import { fetchSystemPromptParts } from '../utils/queryContext.js'
import {
  buildConversationChain,
  flushSessionStorage,
  loadTranscriptFile,
  recordTranscript,
  resetSessionFilePointer,
} from '../utils/sessionStorage.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import {
  createGatewayCanUseTool,
  createGatewayToolUseContext,
} from './headless.js'
import { gatewayModels } from './models.js'
import { inlineSkillToCommand, loadGatewayPlugins } from './plugins.js'
import { resolveGatewayModelTransport } from './provider.js'
import { gatewayToolToBeyaTool, isExecutableGatewayTool } from './tools.js'
import type {
  GatewayTaskEvent,
  GatewayTaskRequest,
  JsonObject,
  NormalizedTaskRequest,
  PermissionMode,
  SkillDefinition,
} from './types.js'

type PreparedSession = {
  sessionId: string
  workDir: string
  transcriptPath: string
  priorMessages: Message[]
}

type StreamState = {
  taskId: string
  sessionId: string
  toolNamesById: Map<string, string>
  startedToolIds: Set<string>
  streamingToolInputs: Map<string, {
    id: string
    name: string
    partialJson: string
  }>
}

const sessionRunLocks = new Map<string, Promise<void>>()

export class GatewayTaskRunner {
  async run(
    input: GatewayTaskRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<{
    taskId: string
    sessionId: string
    outputText: string
    events: GatewayTaskEvent[]
    terminal?: unknown
  }> {
    const events: GatewayTaskEvent[] = []
    let outputText = ''
    let terminal: unknown
    let taskId = ''
    let sessionId = ''
    for await (const event of this.stream(input, options)) {
      events.push(event)
      taskId = event.task_id
      sessionId = event.session_id
      if (event.type === 'WORKFLOW_COMPLETED') {
        outputText = event.result
      }
      if (event.type === 'WORKFLOW_FAILED') {
        throw new Error(event.error)
      }
      terminal = event
    }
    return { taskId, sessionId, outputText, terminal, events }
  }

  async *stream(
    input: GatewayTaskRequest,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>> {
    const request = normalizeTaskRequest(input, options.signal)
    const abortController = new AbortController()
    const abortForwarder = () => abortController.abort(request.signal?.reason)
    request.signal?.addEventListener('abort', abortForwarder, { once: true })

    const session = await prepareSession(request.sessionId, request.permissionMode)
    const releaseSessionLock = await acquireSessionRunLock(session.sessionId)
    try {
      yield* this.streamLocked(request, session, abortController)
    } finally {
      releaseSessionLock()
      request.signal?.removeEventListener('abort', abortForwarder)
    }
  }

  private async *streamLocked(
    request: NormalizedTaskRequest,
    session: PreparedSession,
    abortController: AbortController,
  ): AsyncGenerator<Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>> {
    const resolved = await resolveGatewayModelTransport({
      provider: request.provider,
      model: request.model,
    })
    const model = gatewayModels.resolve(resolved.model)
    const runContext = {
      taskId: request.taskId,
      sessionId: session.sessionId,
      signal: abortController.signal,
      metadata: request.metadata,
    }

    const loadedPlugins = await loadGatewayPlugins(request.plugins)
    const pluginErrors = loadedPlugins.flatMap(plugin => plugin.errors)
    if (pluginErrors.length > 0) {
      throw new Error(
        `Failed to load Gateway plugins: ${pluginErrors.map(String).join('; ')}`,
      )
    }

    const mcpServers = Object.assign(
      {},
      ...loadedPlugins.map(plugin => plugin.mcpServers),
    )
    const mcpSnapshot = await connectHeadlessMcpServers(mcpServers)

    const gatewayToolDefinitions = [
      ...request.tools,
      ...loadedPlugins.flatMap(plugin => plugin.tools),
    ]
    const gatewayTools = gatewayToolDefinitions
      .filter(isExecutableGatewayTool)
      .map(tool => gatewayToolToBeyaTool(tool, runContext))
    const pluginCommands = [
      ...loadedPlugins.flatMap(plugin => plugin.commands),
      ...mcpSnapshot.commands,
      ...request.skills
        .filter(isSkillDefinition)
        .map(skill => inlineSkillToCommand(skill, request.agent)),
    ]
    const messages: Message[] = [
      ...session.priorMessages,
      createUserMessage({ content: request.query }),
    ]
    const stagedEvents: Array<Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>> = []
    const emit = (event: Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>) => {
      stagedEvents.push(event)
    }
    const toolUseContext = createGatewayToolUseContext({
      taskId: request.taskId,
      sessionId: session.sessionId,
      model,
      messages,
      gatewayTools: [...gatewayTools, ...mcpSnapshot.tools],
      pluginCommands,
      mcpClients: mcpSnapshot.clients,
      mcpResources: mcpSnapshot.resources,
      permissionMode: request.permissionMode,
      permissionHandler: request.permissionHandler,
      abortController,
      emit,
    })
    const canUseTool = createGatewayCanUseTool({
      taskId: request.taskId,
      sessionId: session.sessionId,
      permissionHandler: request.permissionHandler,
      emit,
    })
    const appState = toolUseContext.getAppState()
    const { defaultSystemPrompt, userContext, systemContext } =
      await fetchSystemPromptParts({
        tools: toolUseContext.options.tools,
        mainLoopModel: model,
        additionalWorkingDirectories: Array.from(
          appState.toolPermissionContext.additionalWorkingDirectories.keys(),
        ),
        mcpClients: toolUseContext.options.mcpClients,
        customSystemPrompt: undefined,
      })
    const systemPrompt = asSystemPrompt([
      ...defaultSystemPrompt,
      ...(request.instructions ? [request.instructions] : []),
    ])

    const streamState: StreamState = {
      taskId: request.taskId,
      sessionId: session.sessionId,
      toolNamesById: new Map(),
      startedToolIds: new Set(),
      streamingToolInputs: new Map(),
    }
    const transcriptMessages: Message[] = [...messages]
    let outputText = ''
    let terminal: unknown

    yield {
      type: 'TASK_STARTED',
      task_id: request.taskId,
      workflow_id: request.taskId,
      session_id: session.sessionId,
      agent: request.agent,
      message: `Task ${request.taskId} started`,
    }

    const scopedRuntimeState = {
      sessionId: asSessionId(session.sessionId),
      sessionProjectDir: dirname(session.transcriptPath),
      originalCwd: session.workDir,
      cwd: session.workDir,
    }
    try {
      await runWithScopedRuntimeState(scopedRuntimeState, () =>
        resetSessionFilePointer(),
      )
      const iterator = runWithScopedRuntimeState(scopedRuntimeState, () =>
        query({
          messages,
          systemPrompt,
          userContext,
          systemContext,
          canUseTool,
          toolUseContext,
          querySource: 'gateway' as never,
          maxTurns: request.maxTurns,
          deps: resolved.deps,
        }),
      )

      while (true) {
        if (abortController.signal.aborted) {
          yield {
            type: 'WORKFLOW_CANCELLED',
            task_id: request.taskId,
            workflow_id: request.taskId,
            session_id: session.sessionId,
            message: 'Task cancelled',
          }
          return
        }

        const next = await runWithScopedRuntimeState(scopedRuntimeState, () =>
          iterator.next(),
        )
        if (next.done) {
          terminal = next.value
          break
        }

        const message = next.value
        if (isTranscriptMessage(message)) {
          transcriptMessages.push(message)
          outputText += extractAssistantText(message)
        }

        for (const event of mapInternalMessageToEvents(message, streamState)) {
          emit(event)
        }

        while (stagedEvents.length > 0) {
          yield stagedEvents.shift()!
        }
      }

      await runWithScopedRuntimeState(scopedRuntimeState, async () => {
        await recordTranscript(transcriptMessages)
        await flushSessionStorage()
      })
    } catch (error) {
      await runWithScopedRuntimeState(scopedRuntimeState, async () => {
        await recordTranscript(transcriptMessages).catch(() => {})
        await flushSessionStorage().catch(() => {})
      })
      yield {
        type: 'WORKFLOW_FAILED',
        task_id: request.taskId,
        workflow_id: request.taskId,
        session_id: session.sessionId,
        message: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error),
      }
      return
    } finally {
      await disconnectHeadlessMcpServers(mcpSnapshot.clients)
    }

    while (stagedEvents.length > 0) {
      yield stagedEvents.shift()!
    }
    yield {
      type: 'WORKFLOW_COMPLETED',
      task_id: request.taskId,
      workflow_id: request.taskId,
      session_id: session.sessionId,
      message: outputText,
      result: outputText,
    }
    void terminal
  }
}

function normalizeTaskRequest(
  input: GatewayTaskRequest,
  signal?: AbortSignal,
): NormalizedTaskRequest {
  if (!input.query || typeof input.query !== 'string') {
    throw new Error('Task query is required')
  }
  return {
    query: input.query,
    sessionId: input.sessionId,
    taskId: input.taskId ?? randomUUID(),
    agent: input.agent ?? 'default',
    instructions: input.instructions,
    model: input.model,
    provider: input.provider,
    maxTurns: input.maxTurns,
    metadata: { ...input.context, ...input.metadata },
    skills: input.skills ?? [],
    plugins: input.plugins ?? [],
    permissionMode: input.permissionMode ?? 'default',
    permissionHandler: input.permissionHandler,
    tools: input.tools ?? [],
    signal,
  }
}

async function acquireSessionRunLock(
  sessionId: string,
): Promise<() => void> {
  const previous = sessionRunLocks.get(sessionId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const queued = previous.then(() => current)
  sessionRunLocks.set(sessionId, queued)
  await previous
  return () => {
    release()
    if (sessionRunLocks.get(sessionId) === queued) {
      sessionRunLocks.delete(sessionId)
    }
  }
}

async function prepareSession(
  sessionId: string | undefined,
  permissionMode: PermissionMode,
): Promise<PreparedSession> {
  if (sessionId) {
    const launchInfo = await sessionService.getSessionLaunchInfo(sessionId)
    if (!launchInfo) throw new Error(`Session not found: ${sessionId}`)
    return {
      sessionId,
      workDir: launchInfo.workDir,
      transcriptPath: launchInfo.filePath,
      priorMessages: await loadPriorMessages(launchInfo),
    }
  }

  const created = await sessionService.createSession(
    process.cwd(),
    undefined,
    permissionMode,
  )
  const launchInfo = await sessionService.getSessionLaunchInfo(created.sessionId)
  if (!launchInfo) {
    throw new Error(`Created session cannot be loaded: ${created.sessionId}`)
  }
  return {
    sessionId: created.sessionId,
    workDir: created.workDir,
    transcriptPath: launchInfo.filePath,
    priorMessages: [],
  }
}

async function loadPriorMessages(
  launchInfo: SessionLaunchInfo,
): Promise<Message[]> {
  const transcript = await loadTranscriptFile(launchInfo.filePath, {
    keepAllLeaves: true,
  })
  const candidates = transcript.leafUuids.size > 0
    ? [...transcript.leafUuids]
        .map(uuid => transcript.messages.get(uuid))
        .filter((message): message is NonNullable<typeof message> => !!message)
    : [...transcript.messages.values()]
  const leaf = candidates
    .filter(message => message.isSidechain !== true)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0]
  if (!leaf) return []
  return buildConversationChain(transcript.messages, leaf)
    .filter(message => message.isSidechain !== true) as Message[]
}

function isSkillDefinition(
  skill: string | SkillDefinition,
): skill is SkillDefinition {
  return typeof skill === 'object' && skill !== null
}

function isTranscriptMessage(message: unknown): message is Message {
  if (!message || typeof message !== 'object') return false
  const type = (message as { type?: unknown }).type
  return (
    type === 'user' ||
    type === 'assistant' ||
    type === 'attachment' ||
    type === 'system'
  )
}

function extractAssistantText(message: Message): string {
  if (message.type !== 'assistant') return ''
  return message.message.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

function mapInternalMessageToEvents(
  message: unknown,
  state: StreamState,
): Array<Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>> {
  if (!message || typeof message !== 'object') return []
  const type = (message as { type?: string }).type
  if (type === 'stream_event') {
    return mapStreamEvent((message as { event?: unknown }).event, state)
  }
  if (type === 'assistant') {
    return mapAssistantMessage(message, state)
  }
  if (type === 'user') {
    return mapUserMessage(message, state)
  }
  return []
}

function mapStreamEvent(
  event: unknown,
  state: StreamState,
): Array<Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>> {
  if (!event || typeof event !== 'object') return []
  const record = event as Record<string, unknown>
  switch (record.type) {
    case 'content_block_start': {
      const index = Number(record.index ?? 0)
      const contentBlock = record.content_block as
        | Partial<ToolUseBlock>
        | undefined
      if (contentBlock?.type !== 'tool_use' || !contentBlock.id) return []
      state.streamingToolInputs.set(String(index), {
        id: contentBlock.id,
        name: contentBlock.name ?? '',
        partialJson: '',
      })
      state.toolNamesById.set(contentBlock.id, contentBlock.name ?? '')
      return []
    }
    case 'content_block_delta': {
      const delta = record.delta as Record<string, unknown> | undefined
      if (!delta) return []
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return [{
          type: 'LLM_PARTIAL',
          task_id: state.taskId,
          workflow_id: state.taskId,
          session_id: state.sessionId,
          message: delta.text,
        }]
      }
      if (
        delta.type === 'thinking_delta' &&
        typeof delta.thinking === 'string'
      ) {
        return [{
          type: 'AGENT_THINKING',
          task_id: state.taskId,
          workflow_id: state.taskId,
          session_id: state.sessionId,
          message: delta.thinking,
        }]
      }
      if (
        delta.type === 'input_json_delta' &&
        typeof delta.partial_json === 'string'
      ) {
        const active = state.streamingToolInputs.get(String(record.index ?? 0))
        if (active) active.partialJson += delta.partial_json
      }
      return []
    }
    case 'content_block_stop': {
      const active = state.streamingToolInputs.get(String(record.index ?? 0))
      if (!active) return []
      state.streamingToolInputs.delete(String(record.index ?? 0))
      let input: JsonObject = {}
      try {
        input = JSON.parse(active.partialJson || '{}') as JsonObject
      } catch {
        input = {}
      }
      return [toolStartedEvent(state, active.id, active.name, input)]
    }
    default:
      return []
  }
}

function mapAssistantMessage(
  message: unknown,
  state: StreamState,
): Array<Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>> {
  const assistant = message as {
    message?: { content?: Array<Record<string, unknown>> }
  }
  const content = assistant.message?.content
  if (!Array.isArray(content)) return []
  const events: Array<Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>> = []

  for (const block of content) {
    if (
      block.type !== 'tool_use' ||
      typeof block.id !== 'string' ||
      typeof block.name !== 'string'
    ) {
      continue
    }
    state.toolNamesById.set(block.id, block.name)
    if (!state.startedToolIds.has(block.id)) {
      events.push(
        toolStartedEvent(
          state,
          block.id,
          block.name,
          isJsonObject(block.input) ? block.input : {},
        ),
      )
    }
  }
  return events
}

function mapUserMessage(
  message: unknown,
  state: StreamState,
): Array<Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>> {
  const user = message as {
    message?: { content?: unknown }
  }
  const content = user.message?.content
  const events: Array<Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'>> = []
  if (!Array.isArray(content)) return events

  for (const block of content) {
    if (
      !block ||
      typeof block !== 'object' ||
      (block as { type?: unknown }).type !== 'tool_result'
    ) {
      continue
    }
    const result = block as {
      tool_use_id?: unknown
      content?: unknown
      is_error?: unknown
    }
    if (typeof result.tool_use_id !== 'string') continue
    events.push({
      type: 'TOOL_OBSERVATION',
      task_id: state.taskId,
      workflow_id: state.taskId,
      session_id: state.sessionId,
      message: state.toolNamesById.get(result.tool_use_id) ?? result.tool_use_id,
      payload: {
        tool_call_id: result.tool_use_id,
        name: state.toolNamesById.get(result.tool_use_id) ?? result.tool_use_id,
        result: result.content,
        is_error: result.is_error === true,
      },
    })
  }
  return events
}

function toolStartedEvent(
  state: StreamState,
  toolCallId: string,
  name: string,
  input: JsonObject,
): Omit<GatewayTaskEvent, 'seq' | 'stream_id' | 'timestamp'> {
  state.startedToolIds.add(toolCallId)
  state.toolNamesById.set(toolCallId, name)
  return {
    type: 'TOOL_INVOKED',
    task_id: state.taskId,
    workflow_id: state.taskId,
    session_id: state.sessionId,
    message: name,
    payload: {
      tool_call_id: toolCallId,
      name,
      input,
    },
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
