import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import {
  buildTool,
  type Tool,
  type ToolResult,
  type ToolUseContext,
} from '../Tool.js'
import type { JsonObject, ToolCallExtra, ToolDefinition } from './types.js'

export function gatewayToolToBeyaTool(
  gatewayTool: ToolDefinition,
  runContext: Pick<ToolCallExtra, 'taskId' | 'sessionId' | 'signal'> & {
    metadata?: Record<string, unknown>
  },
): Tool {
  const inputSchema = z.object({}).passthrough()
  const readOnly = annotationBool(gatewayTool.annotations, 'readOnlyHint', 'readOnly')
  const destructive = annotationBool(
    gatewayTool.annotations,
    'destructiveHint',
    'destructive',
  )
  const openWorld = annotationBool(
    gatewayTool.annotations,
    'openWorldHint',
    'openWorld',
  )

  return buildTool({
    name: gatewayTool.name,
    description: async () => gatewayTool.description,
    inputSchema,
    inputJSONSchema: normalizeJsonSchema(gatewayTool.inputSchema),
    isReadOnly: () => readOnly,
    isDestructive: () => destructive,
    isOpenWorld: () => openWorld,
    isConcurrencySafe: () => readOnly,
    searchHint: gatewayTool.searchHint,
    alwaysLoad: gatewayTool.alwaysLoad,
    maxResultSizeChars: 100_000,
    checkPermissions: async input => {
      if (readOnly) {
        return { behavior: 'allow', updatedInput: input }
      }
      return {
        behavior: 'ask',
        message: `Tool ${gatewayTool.name} requires permission.`,
        updatedInput: input,
        decisionReason: { type: 'mode', mode: 'default' },
      }
    },
    call: async (
      args,
      context: ToolUseContext,
    ): Promise<ToolResult<CallToolResult>> => {
      if (!gatewayTool.execute && !gatewayTool.executor) {
        throw new Error(`Gateway tool ${gatewayTool.name} has no executor`)
      }
      const extra = {
        ...runContext,
        toolCallId: context.toolUseId ?? '',
        signal: context.abortController.signal,
      }
      const result = gatewayTool.execute
        ? await gatewayTool.execute(args, extra)
        : await executeRemoteGatewayTool(gatewayTool, args, extra)
      return { data: result }
    },
    prompt: async () => gatewayTool.description,
    userFacingName: () => gatewayTool.name,
    mapToolResultToToolResultBlockParam: (content, toolUseID) => ({
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: callToolResultToContent(content),
      is_error: content.isError === true,
    }),
  })
}

export function isExecutableGatewayTool(tool: ToolDefinition): boolean {
  return typeof tool.execute === 'function' ||
    (
      tool.executor?.type === 'http' &&
      typeof tool.executor.url === 'string' &&
      tool.executor.url.trim().length > 0
    )
}

async function executeRemoteGatewayTool(
  gatewayTool: ToolDefinition,
  args: Record<string, unknown>,
  extra: ToolCallExtra,
): Promise<CallToolResult> {
  const executor = gatewayTool.executor
  if (!executor || executor.type !== 'http') {
    throw new Error(`Gateway tool ${gatewayTool.name} has no remote executor`)
  }
  const response = await fetch(executor.url, {
    method: executor.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(executor.headers ?? {}),
    },
    body: JSON.stringify({
      tool: executor.toolName || gatewayTool.name,
      namespace: executor.namespace,
      arguments: args,
      task_id: extra.taskId,
      session_id: extra.sessionId,
      tool_call_id: extra.toolCallId,
      metadata: extra.metadata ?? {},
    }),
    signal: extra.signal,
  })
  const text = await response.text()
  let payload: unknown = text
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = text
    }
  }
  if (!response.ok) {
    return {
      content: [{
        type: 'text',
        text: stringifyRemoteResult(payload || `HTTP ${response.status}`),
      }],
      isError: true,
    }
  }
  if (isCallToolResult(payload)) {
    return payload
  }
  const objectPayload = isJsonObject(payload) ? payload : undefined
  const ok = objectPayload?.ok !== false
  const result =
    objectPayload && 'result' in objectPayload
      ? objectPayload.result
      : objectPayload && 'data' in objectPayload
        ? objectPayload.data
        : payload
  return {
    content: [{
      type: 'text',
      text: stringifyRemoteResult(result),
    }],
    isError: !ok,
  }
}

function normalizeJsonSchema(schema: Record<string, unknown> | undefined) {
  if (schema && schema.type === 'object') return schema
  return {
    type: 'object',
    properties: schema?.properties ?? {},
  }
}

function annotationBool(
  annotations: Record<string, unknown> | undefined,
  primary: string,
  legacy: string,
): boolean {
  return annotations?.[primary] === true || annotations?.[legacy] === true
}

function callToolResultToContent(result: CallToolResult): string {
  if (typeof result.content === 'string') {
    return result.content
  }
  if (!Array.isArray(result.content)) {
    return JSON.stringify(result.content ?? '')
  }
  return result.content
    .map(block => {
      if (typeof block === 'object' && block && 'text' in block) {
        return String(block.text)
      }
      return JSON.stringify(block)
    })
    .join('\n')
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCallToolResult(value: unknown): value is CallToolResult {
  if (!isJsonObject(value)) return false
  return Array.isArray(value.content)
}

function stringifyRemoteResult(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value ?? '', null, 2)
}
