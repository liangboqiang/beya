import { randomUUID } from 'crypto'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { runToolUse } from '../services/tools/toolExecution.js'
import { handleDiagnosticsApi } from '../server/api/diagnostics.js'
import { handleModelsApi } from '../server/api/models.js'
import { handleProvidersApi } from '../server/api/providers.js'
import { ApiError, errorResponse } from '../server/middleware/errorHandler.js'
import { sessionService } from '../server/services/sessionService.js'
import type { CreateSessionRepositoryOptions } from '../server/services/repositoryLaunchService.js'
import {
  getTranscriptPathForSession,
  loadTranscriptFile,
} from '../utils/sessionStorage.js'
import { createAssistantMessage } from '../utils/messages.js'
import {
  createGatewayCanUseTool,
  createGatewayToolUseContext,
} from './headless.js'
import { getGatewayBuiltInTools, type GatewayBuiltInTool } from './headlessTools.js'
import { gatewayModels } from './models.js'
import {
  getRegisteredGatewayPlugin,
  getRegisteredGatewaySkill,
  listRegisteredGatewaySkills,
  listRegisteredGatewayPlugins,
  registerGatewayPlugin,
  reloadRegisteredGatewayPlugins,
  unregisterGatewayPlugin,
} from './plugins.js'
import { gatewayTaskService } from './taskService.js'
import type { GatewayTaskRequest, PluginRef, TaskRecord } from './types.js'

export async function handleGatewayRequest(
  req: Request,
  url: URL,
): Promise<Response> {
  try {
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        service: 'beya-gateway',
        timestamp: new Date().toISOString(),
      })
    }
    if (url.pathname === '/readiness') {
      return Response.json({
        status: 'ready',
        service: 'beya-gateway',
        timestamp: new Date().toISOString(),
      })
    }

    if (url.pathname.startsWith('/v1/')) {
      return await handleOpenAICompatibleRequest(req, url)
    }

    const rawSegments = url.pathname.split('/').filter(Boolean)
    if (rawSegments[0] !== 'api') {
      throw ApiError.notFound(`Unknown Gateway path: ${url.pathname}`)
    }

    if (rawSegments[1] === 'v1') {
      throw ApiError.notFound('Versioned Beya Gateway paths are not supported; use /api/*')
    }

    const resource = rawSegments[1]
    const segments = ['api', 'v1', ...rawSegments.slice(1)]
    switch (resource) {
      case 'tasks':
        return await handleTasks(req, url, segments)
      case 'stream':
        return await handleStream(req, url, segments)
      case 'sessions':
        return await handleGatewaySessions(req, url, segments)
      case 'providers':
        return await handleProvidersApi(req, url, legacySegments(segments))
      case 'models':
        return await handleModelsApi(req, url, legacySegments(segments))
      case 'skills':
        return await handleGatewaySkills(req, url, segments)
      case 'plugins':
        return await handleGatewayPlugins(req, url, segments)
      case 'tools':
        return await handleTools(req, url, segments)
      case 'diagnostics':
        return await handleDiagnosticsApi(req, url, legacySegments(segments))
      default:
        throw ApiError.notFound(`Unknown Gateway resource: ${resource ?? '<empty>'}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleTasks(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  const taskId = segments[3]
  const action = segments[4]

  if (taskId === 'stream' && !action) {
    if (req.method !== 'POST') throw methodNotAllowed(req.method)
    const body = await parseTaskBody(req)
    const task = await gatewayTaskService.submit(body)
    return sseResponse(gatewayTaskService.stream(task.task_id), {
      status: 201,
      headers: {
        'x-beya-task-id': task.task_id,
        'x-beya-workflow-id': task.workflow_id,
        ...(task.session_id ? { 'x-beya-session-id': task.session_id } : {}),
      },
    })
  }

  if (!taskId) {
    if (req.method === 'GET') {
      const limit = Number.parseInt(url.searchParams.get('limit') || '50', 10)
      const offset = Number.parseInt(url.searchParams.get('offset') || '0', 10)
      return Response.json(gatewayTaskService.list({
        limit,
        offset,
        status: url.searchParams.get('status') || undefined,
        sessionId: url.searchParams.get('session_id') || undefined,
      }))
    }
    if (req.method === 'POST') {
      const body = await parseTaskBody(req)
      const task = await gatewayTaskService.submit(body)
      return Response.json({
        task_id: task.task_id,
        workflow_id: task.workflow_id,
        session_id: task.session_id,
        status: task.status,
        stream_url: `/api/tasks/${encodeURIComponent(task.task_id)}/stream`,
      }, { status: 201 })
    }
    throw methodNotAllowed(req.method)
  }

  if (!action && req.method === 'GET') {
    const task = gatewayTaskService.get(taskId)
    if (!task) throw ApiError.notFound(`Task not found: ${taskId}`)
    return Response.json(task)
  }

  if (action === 'events' && req.method === 'GET') {
    return Response.json({
      events: gatewayTaskService.getEvents(taskId, {
        lastEventId: url.searchParams.get('last_event_id'),
        types: parseTypes(url),
      }),
    })
  }

  if (action === 'stream' && req.method === 'GET') {
    return sseResponse(gatewayTaskService.stream(taskId, {
      lastEventId: req.headers.get('Last-Event-ID') || url.searchParams.get('last_event_id'),
      types: parseTypes(url),
    }))
  }

  if (action === 'cancel' && req.method === 'POST') {
    const body = await optionalJson(req)
    const ok = gatewayTaskService.cancel(
      taskId,
      typeof body.reason === 'string' ? body.reason : 'cancelled',
    )
    if (!ok) throw ApiError.notFound(`Task not found: ${taskId}`)
    return Response.json({ ok: true })
  }

  throw methodNotAllowed(req.method)
}

async function handleGatewaySessions(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  const sessionId = segments[3]
  const subResource = segments[4]

  if (sessionId && subResource === 'history' && req.method === 'GET') {
    const body = await loadSessionHistory(sessionId)
    return Response.json({
      ...body,
      history: Array.isArray(body.messages) ? body.messages : [],
    })
  }

  if (sessionId && subResource === 'events' && req.method === 'GET') {
    const tasks = gatewayTaskService.list({
      sessionId,
      limit: 1_000,
      offset: 0,
    }).tasks
    const events = tasks
      .flatMap(task => gatewayTaskService.getEvents(task.task_id, {
        lastEventId: url.searchParams.get('last_event_id'),
        types: parseTypes(url),
      }))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    return Response.json({ events })
  }

  if (sessionId && subResource === 'files' && req.method === 'GET') {
    return Response.json({
      session_id: sessionId,
      files: [],
    })
  }

  if (!sessionId) {
    if (req.method === 'GET') {
      const limit = Number.parseInt(url.searchParams.get('limit') || '50', 10)
      const tasks = gatewayTaskService.list({ limit, offset: 0 }).tasks
      const sessions = new Map<string, {
        session_id: string
        task_count: number
        updated_at: string
        task_ids: string[]
      }>()
      for (const task of tasks) {
        const id = task.session_id
        const existing = sessions.get(id)
        const updatedAt = task.completed_at ?? task.started_at ?? task.created_at
        if (existing) {
          existing.task_count++
          existing.task_ids.push(task.task_id)
          if (Date.parse(updatedAt) > Date.parse(existing.updated_at)) {
            existing.updated_at = updatedAt
          }
        } else {
          sessions.set(id, {
            session_id: id,
            task_count: 1,
            updated_at: updatedAt,
            task_ids: [task.task_id],
          })
        }
      }
      return Response.json({ sessions: [...sessions.values()] })
    }

    if (req.method === 'POST') {
      const body = await optionalJson(req)
      const workDir = stringField(body.workDir) ?? stringField(body.work_dir)
      const permissionMode =
        stringField(body.permissionMode) ?? stringField(body.permission_mode)
      const repository = objectField(body.repository) as
        | CreateSessionRepositoryOptions
        | undefined
      const created = await sessionService.createSession(
        workDir,
        repository,
        permissionMode,
      )
      return Response.json({
        session_id: created.sessionId,
        work_dir: created.workDir,
        title: stringField(body.title) ?? null,
        created_at: new Date().toISOString(),
      }, { status: 201 })
    }

    throw methodNotAllowed(req.method)
  }

  if (!subResource && req.method === 'GET') {
    const tasks = gatewayTaskService.list({
      sessionId,
      limit: 1_000,
      offset: 0,
    }).tasks
    return Response.json({
      session_id: sessionId,
      task_count: tasks.length,
      tasks,
    })
  }

  if (!subResource && req.method === 'PATCH') {
    const body = await optionalJson(req)
    return Response.json({
      session_id: sessionId,
      title: stringField(body.title) ?? null,
      tag: stringField(body.tag) ?? null,
      updated_at: new Date().toISOString(),
    })
  }

  if (!subResource && req.method === 'DELETE') {
    return Response.json({ ok: true, session_id: sessionId })
  }

  throw methodNotAllowed(req.method)
}

async function handleGatewaySkills(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  const skillName = segments[3]
  const extra = segments[4]

  if (!skillName) {
    if (req.method !== 'GET') throw methodNotAllowed(req.method)
    return Response.json(await listRegisteredGatewaySkills())
  }

  if (extra || req.method !== 'GET') {
    throw extra
      ? ApiError.notFound(`Unknown skill endpoint: ${skillName}/${extra}`)
      : methodNotAllowed(req.method)
  }

  const decodedName = decodeURIComponent(skillName)
  try {
    return Response.json(await getRegisteredGatewaySkill(decodedName))
  } catch (error) {
    throw ApiError.notFound(error instanceof Error ? error.message : String(error))
  }
}

async function loadSessionHistory(sessionId: string): Promise<Record<string, unknown>> {
  try {
    const transcriptPath = getTranscriptPathForSession(sessionId)
    const transcript = await loadTranscriptFile(transcriptPath)
    return {
      session_id: sessionId,
      transcript_path: transcriptPath,
      messages: transcript.messages ?? [],
    }
  } catch {
    return {
      session_id: sessionId,
      messages: [],
    }
  }
}

async function handleGatewayPlugins(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  const pluginId = segments[3]
  const action = segments[4]

  if (!pluginId) {
    if (req.method === 'POST') {
      const body = await optionalJson(req)
      const ref = pluginRefFromBody(body)
      const id =
        stringField(body.id) ??
        stringField(body.plugin_id) ??
        stringField(body.name)
      return Response.json(await registerGatewayPlugin(ref, id))
    }
    if (req.method === 'GET') {
      return Response.json(await listRegisteredGatewayPlugins())
    }
    throw methodNotAllowed(req.method)
  }

  const decodedId = decodeURIComponent(pluginId)

  if (!action && req.method === 'GET') {
    try {
      return Response.json(await getRegisteredGatewayPlugin(decodedId))
    } catch (error) {
      throw ApiError.notFound(error instanceof Error ? error.message : String(error))
    }
  }

  if (!action && req.method === 'DELETE') {
    return Response.json({ ok: unregisterGatewayPlugin(decodedId) })
  }

  if (decodedId === 'reload' && !action && req.method === 'POST') {
    return Response.json(await reloadRegisteredGatewayPlugins())
  }

  if (action === 'reload' && req.method === 'POST') {
    return Response.json(await reloadRegisteredGatewayPlugins())
  }

  throw ApiError.notFound(`Unknown plugin endpoint: ${decodedId}${action ? `/${action}` : ''}`)
}

function pluginRefFromBody(body: Record<string, unknown>): PluginRef {
  if (body.type === 'inline' && objectField(body.definition)) {
    return {
      type: 'inline',
      definition: objectField(body.definition) as never,
    }
  }
  if (objectField(body.plugin) && (body.plugin as Record<string, unknown>).type === 'inline') {
    return body.plugin as PluginRef
  }
  const path =
    stringField(body.path) ??
    stringField(body.plugin_path) ??
    stringField(body.pluginPath)
  if (!path) {
    throw ApiError.badRequest('Missing plugin path or inline plugin definition')
  }
  return { type: 'local', path }
}

async function handleStream(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  if (segments[3] !== 'sse' || req.method !== 'GET') {
    throw ApiError.notFound(`Unknown stream endpoint: ${segments.slice(2).join('/')}`)
  }
  const taskId = url.searchParams.get('task_id') || url.searchParams.get('workflow_id')
  if (!taskId) throw ApiError.badRequest('Missing task_id')
  return sseResponse(gatewayTaskService.stream(taskId, {
    lastEventId: req.headers.get('Last-Event-ID') || url.searchParams.get('last_event_id'),
    types: parseTypes(url),
  }))
}

async function handleTools(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  const toolName = segments[3]
  const action = segments[4]
  const toolPermissionContext = getEmptyToolPermissionContext()
  const tools = getGatewayBuiltInTools(toolPermissionContext)
  if (!toolName && req.method === 'GET') {
    return Response.json({
      tools: await Promise.all(tools.map(tool =>
        gatewayToolInfo(tool, tools, toolPermissionContext),
      )),
    })
  }

  const tool = tools.find(candidate => candidate.name === toolName)
  if (!tool) throw ApiError.notFound(`Tool not found: ${toolName}`)

  if (!action && req.method === 'GET') {
    return Response.json({
      tool: await gatewayToolInfo(tool, tools, toolPermissionContext),
    })
  }

  if (action === 'execute' && req.method === 'POST') {
    const body = await optionalJson(req)
    const input = objectField(body.input) ?? objectField(body.args) ?? {}
    const taskId = stringField(body.task_id) ?? stringField(body.taskId) ?? randomUUID()
    const sessionId =
      stringField(body.session_id) ?? stringField(body.sessionId) ?? taskId
    const toolUseId =
      stringField(body.tool_call_id) ??
      stringField(body.toolCallId) ??
      `toolu_gateway_${randomUUID().replace(/-/g, '')}`
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
    const toolUseContext = createGatewayToolUseContext({
      taskId,
      sessionId,
      model: 'gateway-direct-tool',
      messages: [assistantMessage],
      gatewayTools: [],
      pluginCommands: [],
      permissionMode: stringField(body.permission_mode) as never ?? 'default',
      abortController: new AbortController(),
      emit: event => {
        events.push(event)
      },
    })
    const canUseTool = createGatewayCanUseTool({
      taskId,
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
      task_id: taskId,
      session_id: sessionId,
      tool: tool.name,
      input,
      events,
      messages,
      result: extractToolExecutionResult(messages, toolUseId),
    })
  }

  throw methodNotAllowed(req.method)
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

async function gatewayToolInfo(
  tool: GatewayBuiltInTool,
  tools: readonly GatewayBuiltInTool[],
  toolPermissionContext: ReturnType<typeof getEmptyToolPermissionContext>,
) {
  const emptyInput = {}
  return {
    name: tool.name,
    description: await tool.description(emptyInput, {
      isNonInteractiveSession: true,
      toolPermissionContext,
      tools,
    }),
    parameters: tool.inputJSONSchema ?? {},
    read_only: toolFlag(tool, 'isReadOnly'),
    destructive: toolFlag(tool, 'isDestructive'),
    open_world: toolFlag(tool, 'isOpenWorld'),
  }
}

function toolFlag(
  tool: GatewayBuiltInTool,
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

async function handleOpenAICompatibleRequest(
  req: Request,
  url: URL,
): Promise<Response> {
  if (url.pathname === '/v1/models' && req.method === 'GET') {
    const { models } = await gatewayModels.list()
    return Response.json({
      object: 'list',
      data: models.map(model => ({
        id: model.id,
        object: 'model',
        created: 0,
        owned_by: model.provider_id ?? 'beya',
      })),
    })
  }

  if (url.pathname.startsWith('/v1/models/') && req.method === 'GET') {
    const modelId = decodeURIComponent(url.pathname.slice('/v1/models/'.length))
    const { models } = await gatewayModels.list()
    const model = models.find(item => item.id === modelId)
    if (!model) throw ApiError.notFound(`Model not found: ${modelId}`)
    return Response.json({
      id: model.id,
      object: 'model',
      created: 0,
      owned_by: model.provider_id ?? 'beya',
    })
  }

  if (
    (url.pathname === '/v1/chat/completions' ||
      url.pathname === '/v1/completions') &&
    req.method === 'POST'
  ) {
    return handleChatCompletions(req)
  }

  throw ApiError.notFound(`Unknown OpenAI-compatible endpoint: ${url.pathname}`)
}

async function handleChatCompletions(req: Request): Promise<Response> {
  const body = await optionalJson(req)
  const messages = Array.isArray(body.messages) ? body.messages : []
  const prompt = typeof body.prompt === 'string'
    ? body.prompt
    : messages
        .map(message => typeof message?.content === 'string' ? message.content : '')
        .filter(Boolean)
        .join('\n')
  if (!prompt.trim()) throw ApiError.badRequest('Missing prompt or messages')

  const task = await gatewayTaskService.submit({
    query: prompt,
    model: typeof body.model === 'string' ? body.model : undefined,
    sessionId: typeof body.session_id === 'string' ? body.session_id : undefined,
    metadata: {
      openai_compatible: true,
    },
  })

  if (body.stream === true) {
    return new Response(openAIStream(task.task_id, body.model), {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  }

  const completed = await waitForTask(task.task_id)
  if (completed.status === 'FAILED') {
    throw new ApiError(500, completed.error_message || 'Task failed', 'TASK_FAILED')
  }
  return Response.json({
    id: `chatcmpl-${task.task_id}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof body.model === 'string' ? body.model : 'beya',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: completed.result ?? '',
      },
      finish_reason: completed.status === 'CANCELLED' ? 'stop' : 'stop',
    }],
    usage: null,
    beya_task_id: task.task_id,
    beya_session_id: completed.session_id,
  })
}

function openAIStream(taskId: string, model: unknown): ReadableStream<Uint8Array> {
  const native = gatewayTaskService.stream(taskId)
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = native.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        buffer += decoder.decode(next.value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const raw of chunks) {
          const dataLine = raw.split('\n').find(line => line.startsWith('data: '))
          if (!dataLine) continue
          const event = JSON.parse(dataLine.slice('data: '.length))
          if (event.type === 'LLM_PARTIAL') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              id: `chatcmpl-${taskId}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: typeof model === 'string' ? model : 'beya',
              choices: [{
                index: 0,
                delta: { content: event.message },
                finish_reason: null,
              }],
              beya_events: [event],
            })}\n\n`))
          }
          if (
            event.type === 'WORKFLOW_COMPLETED' ||
            event.type === 'WORKFLOW_FAILED' ||
            event.type === 'WORKFLOW_CANCELLED'
          ) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              id: `chatcmpl-${taskId}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: typeof model === 'string' ? model : 'beya',
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop',
              }],
              beya_events: [event],
            })}\n\n`))
          }
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

async function waitForTask(taskId: string): Promise<TaskRecord> {
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const task = gatewayTaskService.get(taskId)
    if (!task) throw ApiError.notFound(`Task not found: ${taskId}`)
    if (
      task.status === 'COMPLETED' ||
      task.status === 'FAILED' ||
      task.status === 'CANCELLED'
    ) {
      return task
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new ApiError(504, `Task timed out: ${taskId}`, 'TASK_TIMEOUT')
}

async function parseTaskBody(req: Request): Promise<GatewayTaskRequest> {
  const body = await optionalJson(req)
  const query = typeof body.query === 'string'
    ? body.query
    : typeof body.input === 'string'
      ? body.input
      : ''
  if (!query.trim()) throw ApiError.badRequest('Missing query')
  return {
    query,
    sessionId: stringField(body.session_id) ?? stringField(body.sessionId),
    taskId: stringField(body.task_id) ?? stringField(body.taskId),
    agent: stringField(body.agent),
    instructions: stringField(body.instructions),
    model: stringField(body.model) ?? stringField(body.model_override),
    provider: stringField(body.provider) ?? stringField(body.provider_override),
    mode: stringField(body.mode),
    context: objectField(body.context),
    metadata: objectField(body.metadata),
    maxTurns: numberField(body.max_turns) ?? numberField(body.maxTurns),
    skills: Array.isArray(body.skills)
      ? body.skills as never
      : stringField(body.skill)
        ? [stringField(body.skill)] as never
        : undefined,
    plugins: Array.isArray(body.plugins) ? body.plugins as never : undefined,
    permissionMode: stringField(body.permission_mode) as never,
  }
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

function parseTypes(url: URL): string[] | undefined {
  const raw = url.searchParams.get('types')
  if (!raw) return undefined
  return raw.split(',').map(type => type.trim()).filter(Boolean)
}

function legacySegments(segments: string[]): string[] {
  return ['api', segments[2], ...segments.slice(3)]
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function sseResponse(
  stream: ReadableStream<Uint8Array>,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'text/event-stream; charset=utf-8')
  headers.set('cache-control', 'no-cache, no-transform')
  headers.set('connection', 'keep-alive')
  return new Response(stream, {
    ...init,
    headers,
  })
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
