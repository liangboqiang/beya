import { randomUUID } from 'crypto'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { runToolUse } from '../../services/tools/toolExecution.js'
import { ApiError } from '../middleware/errorHandler.js'
import { createAssistantMessage } from '../../utils/messages.js'
import {
  createHeadlessCanUseTool,
  createHeadlessToolUseContext,
} from '../services/headlessRuntime.js'
import {
  loadSessionRuntimeSurface,
  runtimeToolInfo,
} from '../services/sessionRuntimeSurface.js'

export async function handleServerTools(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  const toolName = segments[2]
  const action = segments[3]
  const requestedSessionId =
    url.searchParams.get('session_id') ||
    url.searchParams.get('sessionId') ||
    undefined
  const requestedCwd = url.searchParams.get('cwd') || undefined
  const surface = await loadSessionRuntimeSurface({
    sessionId: requestedSessionId,
    cwd: requestedCwd,
    permissionContext: getEmptyToolPermissionContext(),
  })

  if (!toolName && req.method === 'GET') {
    return Response.json({
      tools: await Promise.all(surface.tools.map(tool =>
        runtimeToolInfo(tool, surface),
      )),
    })
  }

  if (!action && req.method === 'GET') {
    const tool = surface.tools.find(candidate => candidate.name === toolName)
    if (!tool) throw ApiError.notFound(`Tool not found: ${toolName}`)
    return Response.json({
      tool: await runtimeToolInfo(tool, surface),
    })
  }

  if (action === 'execute' && req.method === 'POST') {
    const body = await optionalJson(req)
    const input = objectField(body.input) ?? objectField(body.args) ?? {}
    const runId = stringField(body.run_id) ?? stringField(body.task_id) ?? stringField(body.taskId) ?? randomUUID()
    const sessionId =
      stringField(body.session_id) ?? stringField(body.sessionId) ?? runId
    const metadata = objectField(body.metadata) ?? {}
    const directAbortController = new AbortController()
    const executionSurface = await loadSessionRuntimeSurface({
      sessionId,
      cwd: requestedCwd,
      metadata,
      permissionContext: getEmptyToolPermissionContext(),
    })
    const tool = executionSurface.tools.find(candidate => candidate.name === toolName)
    if (!tool) throw ApiError.notFound(`Tool not found: ${toolName}`)
    const toolUseId =
      stringField(body.tool_call_id) ??
      stringField(body.toolCallId) ??
      `toolu_server_${randomUUID().replace(/-/g, '')}`
    const events: unknown[] = []
    const assistantMessage = createAssistantMessage({
      content: [{
        type: 'tool_use',
        id: toolUseId,
        name: tool.name,
        input,
      } as ToolUseBlock],
      isVirtual: true,
    })
    const toolUseContext = createHeadlessToolUseContext({
      taskId: runId,
      sessionId,
      model: 'beya-server-direct-tool',
      messages: [assistantMessage],
      serverTools: [tool],
      pluginCommands: [],
      permissionMode: stringField(body.permission_mode) as never ?? 'default',
      abortController: directAbortController,
      emit: event => {
        events.push(event)
      },
    })
    const canUseTool = createHeadlessCanUseTool({
      taskId: runId,
      sessionId,
      emit: event => {
        events.push(event)
      },
    })

    const messages = []
    for await (const update of runToolUse(
      {
        type: 'tool_use',
        id: toolUseId,
        name: tool.name,
        input,
      },
      assistantMessage,
      canUseTool,
      toolUseContext,
    )) {
      messages.push(update.message)
      if (update.contextModifier) {
        update.contextModifier.modifyContext(toolUseContext)
      }
    }

    return Response.json({
      tool_call_id: toolUseId,
      run_id: runId,
      session_id: sessionId,
      tool: tool.name,
      input,
      events,
      messages,
      result: extractToolExecutionResult(messages, toolUseId),
    })
  }

  throw new ApiError(
    405,
    `Method ${req.method} not allowed on /api/tools${toolName ? `/${toolName}` : ''}`,
    'METHOD_NOT_ALLOWED',
  )
}

function extractToolExecutionResult(
  messages: unknown[],
  toolUseId: string,
): unknown {
  for (const message of messages) {
    const content = (message as {
      message?: { content?: unknown }
    })?.message?.content
    if (!Array.isArray(content)) continue
    const block = content.find(item =>
      item &&
      typeof item === 'object' &&
      (item as { type?: unknown }).type === 'tool_result' &&
      (item as { tool_use_id?: unknown }).tool_use_id === toolUseId
    )
    if (block && typeof block === 'object') {
      return {
        content: (block as { content?: unknown }).content,
        is_error: (block as { is_error?: unknown }).is_error === true,
      }
    }
  }
  return null
}

async function optionalJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json()
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
