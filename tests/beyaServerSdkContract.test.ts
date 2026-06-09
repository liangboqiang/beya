import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleApiRequest } from '../src/server/router.js'
import {
  SESSION_WS_CANONICAL_PATH,
  sessionWebSocketIdFromPath,
} from '../src/server/ws/sessionWsPath.js'
import { toolDefinitionToBeyaTool, isExecutableToolDefinition } from '../src/server/services/beyaToolDefinitions.js'
import { loadInstalledBeyaPlugins } from '../src/server/services/beyaPluginRuntime.js'

describe('Beya Server SDK contract', () => {
  it('exposes health and readiness through /api/*', async () => {
    const health = await handleApiRequest(
      new Request('http://127.0.0.1/api/health'),
      new URL('http://127.0.0.1/api/health'),
    )
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      status: 'ok',
      service: 'beya-server',
    })

    const readiness = await handleApiRequest(
      new Request('http://127.0.0.1/api/readiness'),
      new URL('http://127.0.0.1/api/readiness'),
    )
    expect(readiness.status).toBe(200)
    expect(await readiness.json()).toMatchObject({
      status: 'ready',
      service: 'beya-server',
    })
  })

  it('uses /api/* as the canonical Server path and rejects legacy external paths', async () => {
    const canonical = await handleApiRequest(
      new Request('http://127.0.0.1/api/tools'),
      new URL('http://127.0.0.1/api/tools'),
    )
    expect(canonical.status).toBe(200)

    const versioned = await handleApiRequest(
      new Request('http://127.0.0.1/api/v1/tools'),
      new URL('http://127.0.0.1/api/v1/tools'),
    )
    expect(versioned.status).toBe(404)

    const topHealth = await handleApiRequest(
      new Request('http://127.0.0.1/health'),
      new URL('http://127.0.0.1/health'),
    )
    expect(topHealth.status).toBe(404)

    const openaiHelper = await handleApiRequest(
      new Request('http://127.0.0.1/api/openai/chat/completions', { method: 'POST' }),
      new URL('http://127.0.0.1/api/openai/chat/completions'),
    )
    expect(openaiHelper.status).toBe(404)
  })

  it('uses the concise session WebSocket path and rejects REST-style WebSocket residue', () => {
    expect(SESSION_WS_CANONICAL_PATH).toBe('/ws/{sessionId}')
    expect(sessionWebSocketIdFromPath('/ws/session-1')).toBe('session-1')
    expect(sessionWebSocketIdFromPath('/api/sessions/session-1/ws')).toBeNull()
    expect(sessionWebSocketIdFromPath('/api/sessions/session-1/chat')).toBeNull()
  })

  it('keeps /api/tasks limited to Desktop/CLI task-list semantics', async () => {
    const postRun = await handleApiRequest(
      new Request('http://127.0.0.1/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'hello' }),
      }),
      new URL('http://127.0.0.1/api/tasks'),
    )
    expect(postRun.status).toBe(405)

    const stream = await handleApiRequest(
      new Request('http://127.0.0.1/api/tasks/task-1/stream'),
      new URL('http://127.0.0.1/api/tasks/task-1/stream'),
    )
    expect(stream.status).toBe(404)

    const sse = await handleApiRequest(
      new Request('http://127.0.0.1/api/stream/sse?task_id=task-1'),
      new URL('http://127.0.0.1/api/stream/sse?task_id=task-1'),
    )
    expect(sse.status).toBe(404)
  })

  it('lists the server tool surface through /api/tools', async () => {
    const response = await handleApiRequest(
      new Request('http://127.0.0.1/api/tools'),
      new URL('http://127.0.0.1/api/tools'),
    )
    expect(response.status).toBe(200)
    const body = await response.json() as { tools: Array<{ name: string }> }
    expect(Array.isArray(body.tools)).toBe(true)
  })

  it('returns stable errors for direct tool execution when no tool is installed', async () => {
    const request = new Request('http://127.0.0.1/api/tools/missing_tool/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })
    const response = await handleApiRequest(request, new URL(request.url))
    expect(response.status).toBe(404)
  })

  it('wraps remote HTTP plugin tools as executable Beya tools', async () => {
    const calls: unknown[] = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async req => {
        const payload = await req.json()
        calls.push({
          headers: Object.fromEntries(req.headers.entries()),
          payload,
        })
        return Response.json({
          ok: true,
          result: {
            echoed: payload.arguments,
            tool_call_id: payload.tool_call_id,
          },
        })
      },
    })
    try {
      const abortController = new AbortController()
      const toolDef = {
        name: 'remote_echo',
        description: 'Remote echo tool',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        annotations: { readOnlyHint: true },
        executor: {
          type: 'http' as const,
          url: `http://127.0.0.1:${server.port}/tool`,
          headers: { 'x-test-token': 'token-1' },
          toolName: 'mc_design_echo',
          namespace: 'local',
        },
      }
      expect(isExecutableToolDefinition(toolDef)).toBe(true)
      const tool = toolDefinitionToBeyaTool(toolDef, {
        taskId: 'run-1',
        sessionId: 'session-1',
        signal: abortController.signal,
        metadata: { source: 'contract-test' },
      })
      const result = await tool.call(
        { message: 'hello' },
        {
          toolUseId: 'toolu-1',
          abortController,
        } as any,
        async () => ({ behavior: 'allow' }) as any,
        {} as any,
      ) as any
      expect(result.data.isError).toBe(false)
      expect(result.data.content[0].text).toContain('"message": "hello"')
      expect(calls).toHaveLength(1)
      expect((calls[0] as any).headers['x-test-token']).toBe('token-1')
      expect((calls[0] as any).payload).toMatchObject({
        tool: 'mc_design_echo',
        namespace: 'local',
        arguments: { message: 'hello' },
        task_id: 'run-1',
        session_id: 'session-1',
        tool_call_id: 'toolu-1',
        metadata: { source: 'contract-test' },
      })
    } finally {
      server.stop(true)
    }
  })

  it('installs SDK inline plugins through the existing server plugin runtime', async () => {
    const originalConfigDir = process.env.BEYA_CONFIG_DIR
    const configDir = await mkdtemp(join(tmpdir(), 'beya-server-plugin-'))
    process.env.BEYA_CONFIG_DIR = configDir
    const executor = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const payload = await request.json() as { arguments?: { message?: string } }
        return Response.json({
          ok: true,
          result: {
            echoed: payload.arguments?.message ?? '',
          },
        })
      },
    })
    try {
      const request = new Request('http://127.0.0.1/api/plugins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'inline',
          scope: 'user',
          definition: {
            name: 'sdk-inline-plugin',
            description: 'SDK inline plugin',
            skills: [{
              name: 'design_review',
              description: 'Review design',
              content: 'Review design constraints before using tools.',
              allowedTools: ['remote_echo'],
            }],
            tools: [{
              name: 'remote_echo',
              description: 'Remote echo',
              inputSchema: {
                type: 'object',
                properties: { message: { type: 'string' } },
              },
              executor: {
                type: 'http',
                url: new URL('/tool', executor.url).toString(),
                toolName: 'remote_echo',
              },
              annotations: { readOnlyHint: true },
            }],
            resources: ['Reference material for sdk-inline-plugin.'],
          },
        }),
      })

      const response = await handleApiRequest(request, new URL(request.url))
      expect(response.status).toBe(200)
      const body = await response.json() as {
        ok: boolean
        pluginId: string
        installPath: string
      }
      expect(body).toMatchObject({
        ok: true,
        pluginId: 'sdk-inline-plugin@local',
      })
      expect(body.installPath.startsWith(configDir)).toBe(true)

      const manifest = JSON.parse(await readFile(
        join(body.installPath, '.beya-plugin', 'plugin.json'),
        'utf-8',
      )) as Record<string, unknown>
      expect(manifest).toMatchObject({
        name: 'sdk-inline-plugin',
        skills: './skills',
        tools: './tools',
        resources: './resources',
      })

      const loaded = await loadInstalledBeyaPlugins()
      expect(loaded.some(plugin => plugin.name === 'sdk-inline-plugin')).toBe(true)
    } finally {
      executor.stop(true)
      if (originalConfigDir === undefined) {
        delete process.env.BEYA_CONFIG_DIR
      } else {
        process.env.BEYA_CONFIG_DIR = originalConfigDir
      }
      await rm(configDir, { recursive: true, force: true })
    }
  })
})
