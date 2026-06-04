import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleGatewayRequest } from '../src/gateway/handler.js'
import { sessionService } from '../src/server/services/sessionService.js'
import { gatewayToolToBeyaTool, isExecutableGatewayTool } from '../src/gateway/tools.js'

describe('Beya unified Gateway contract', () => {
  it('exposes health and readiness through the unified Gateway', async () => {
    const health = await handleGatewayRequest(
      new Request('http://127.0.0.1/health'),
      new URL('http://127.0.0.1/health'),
    )
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      status: 'ok',
      service: 'beya-gateway',
    })

    const readiness = await handleGatewayRequest(
      new Request('http://127.0.0.1/readiness'),
      new URL('http://127.0.0.1/readiness'),
    )
    expect(readiness.status).toBe(200)
    expect(await readiness.json()).toMatchObject({
      status: 'ready',
      service: 'beya-gateway',
    })
  })

  it('uses /api/* as the canonical Gateway path and rejects versioned Beya API paths', async () => {
    const canonical = await handleGatewayRequest(
      new Request('http://127.0.0.1/api/tools'),
      new URL('http://127.0.0.1/api/tools'),
    )
    expect(canonical.status).toBe(200)

    const legacyPath = ['api', 'v1', 'tools'].join('/')
    const versioned = await handleGatewayRequest(
      new Request(`http://127.0.0.1/${legacyPath}`),
      new URL(`http://127.0.0.1/${legacyPath}`),
    )
    expect(versioned.status).toBe(404)
  })

  it('delegates existing Beya server APIs through the same Gateway handler', async () => {
    const response = await handleGatewayRequest(
      new Request('http://127.0.0.1/api/models'),
      new URL('http://127.0.0.1/api/models'),
    )
    expect(response.status).toBe(200)
    const body = await response.json() as { models?: unknown[] }
    expect(Array.isArray(body.models)).toBe(true)
  })

  it('lists the headless Gateway tool surface through /api/tools', async () => {
    const response = await handleGatewayRequest(
      new Request('http://127.0.0.1/api/tools'),
      new URL('http://127.0.0.1/api/tools'),
    )
    expect(response.status).toBe(200)
    const body = await response.json() as { tools: Array<{ name: string }> }
    expect(Array.isArray(body.tools)).toBe(true)
  })

  it('returns stable errors for direct tool execution when no headless tool is installed', async () => {
    const request = new Request('http://127.0.0.1/api/tools/missing_tool/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })
    const response = await handleGatewayRequest(request, new URL(request.url))
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
      expect(isExecutableGatewayTool(toolDef)).toBe(true)
      const tool = gatewayToolToBeyaTool(toolDef, {
        taskId: 'task-1',
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
        task_id: 'task-1',
        session_id: 'session-1',
        tool_call_id: 'toolu-1',
        metadata: { source: 'contract-test' },
      })
    } finally {
      server.stop(true)
    }
  })

  it('accepts skills and plugins in task submission payloads', async () => {
    const request = new Request('http://127.0.0.1/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'hello',
        skills: ['design-review'],
        plugins: [{ type: 'inline', definition: { name: 'inline-plugin' } }],
      }),
    })
    const response = await handleGatewayRequest(request, new URL(request.url))
    expect(response.status).toBe(201)
    const body = await response.json() as {
      task_id: string
      stream_url: string
    }
    expect(body.task_id).toBeTruthy()
    expect(body.stream_url.startsWith('/api/tasks/')).toBe(true)
  })

  it('creates real Beya sessions that Gateway tasks can resume', async () => {
    const originalConfigDir = process.env.BEYA_CONFIG_DIR
    const configDir = await mkdtemp(join(tmpdir(), 'beya-gateway-session-'))
    const workDir = await mkdtemp(join(tmpdir(), 'beya-gateway-work-'))
    process.env.BEYA_CONFIG_DIR = configDir
    try {
      const request = new Request('http://127.0.0.1/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workDir }),
      })
      const response = await handleGatewayRequest(request, new URL(request.url))
      expect(response.status).toBe(201)
      const body = await response.json() as {
        session_id: string
        work_dir: string
      }
      expect(body.session_id).toBeTruthy()
      expect(body.work_dir).toBe(workDir)
      const launchInfo = await sessionService.getSessionLaunchInfo(body.session_id)
      expect(launchInfo?.workDir).toBe(workDir)
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.BEYA_CONFIG_DIR
      } else {
        process.env.BEYA_CONFIG_DIR = originalConfigDir
      }
      await rm(configDir, { recursive: true, force: true })
      await rm(workDir, { recursive: true, force: true })
    }
  })

  it('exposes OpenAI-compatible model list through /v1/models', async () => {
    const response = await handleGatewayRequest(
      new Request('http://127.0.0.1/v1/models'),
      new URL('http://127.0.0.1/v1/models'),
    )
    expect(response.status).toBe(200)
    const body = await response.json() as { object: string; data: unknown[] }
    expect(body.object).toBe('list')
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('wraps Gateway skill and plugin management endpoints under /api/*', async () => {
    const skills = await handleGatewayRequest(
      new Request('http://127.0.0.1/api/skills'),
      new URL('http://127.0.0.1/api/skills'),
    )
    expect(skills.status).toBe(200)

    const plugins = await handleGatewayRequest(
      new Request('http://127.0.0.1/api/plugins'),
      new URL('http://127.0.0.1/api/plugins'),
    )
    expect(plugins.status).toBe(200)
  })
})
