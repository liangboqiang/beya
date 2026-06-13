import { describe, it, expect } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { WebSocketServer } from 'ws'
import { AdapterHttpClient } from '../http-client.js'

type RpcRequestRecord = {
  method: string
  params: Record<string, unknown>
}

async function withRpcServer<T>(
  handler: (request: RpcRequestRecord) => { status?: number; body?: unknown },
  run: (input: { url: string; requests: RpcRequestRecord[] }) => Promise<T>,
): Promise<T> {
  const requests: RpcRequestRecord[] = []
  const server = new WebSocketServer({ port: 0 })
  server.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'rpc.connected', schemaHash: 'test-hash' }))
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as {
        id: string
        method: string
        params: Record<string, unknown>
      }
      const request = { method: frame.method, params: frame.params }
      requests.push(request)
      const response = handler(request)
      ws.send(JSON.stringify({
        type: 'rpc.response',
        id: frame.id,
        status: response.status ?? 200,
        headers: {},
        result: response.body ?? {},
      }))
    })
  })

  await new Promise<void>((resolve) => server.on('listening', () => resolve()))
  const port = (server.address() as { port: number }).port

  try {
    return await run({ url: `ws://127.0.0.1:${port}`, requests })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('AdapterHttpClient', () => {
  it('derives HTTP and RPC URLs from WS URL', () => {
    const client = new AdapterHttpClient('ws://127.0.0.1:3456')
    expect(client.httpBaseUrl).toBe('http://127.0.0.1:3456')
    expect(client.rpcWebSocketUrl).toBe('ws://127.0.0.1:3456/rpc')

    const secure = new AdapterHttpClient('wss://example.com:443')
    expect(secure.httpBaseUrl).toBe('https://example.com:443')
    expect(secure.rpcWebSocketUrl).toBe('wss://example.com:443/rpc')
  })

  it('createSession calls sessions.create over RPC', async () => {
    const mockSessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    await withRpcServer(
      () => ({ status: 201, body: { sessionId: mockSessionId } }),
      async ({ url, requests }) => {
        const client = new AdapterHttpClient(url)

        const sessionId = await client.createSession('/path/to/project')

        expect(sessionId).toBe(mockSessionId)
        expect(requests[0]).toMatchObject({
          method: 'sessions.create',
          params: {
            body: { workDir: '/path/to/project' },
          },
        })
      },
    )
  })

  it('listRecentProjects calls sessions.recentprojects over RPC', async () => {
    const mockProjects = [
      { projectName: 'my-app', realPath: '/home/user/my-app', sessionCount: 3 },
    ]
    await withRpcServer(
      () => ({ body: { projects: mockProjects } }),
      async ({ url, requests }) => {
        const client = new AdapterHttpClient(url)

        const projects = await client.listRecentProjects()

        expect(projects).toHaveLength(1)
        expect(projects[0]?.projectName).toBe('my-app')
        expect(requests[0]?.method).toBe('sessions.recentprojects')
      },
    )
  })

  it('matchProject accepts an absolute local project path inside an allowed root without recent history', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-root-'))
    const projectDir = fs.mkdtempSync(path.join(rootDir, 'project-'))
    try {
      const client = new AdapterHttpClient('ws://127.0.0.1:3456', { allowedProjectRoots: [rootDir] })

      const result = await client.matchProject(projectDir)

      expect(result.project?.realPath).toBe(fs.realpathSync(projectDir))
      expect(result.project?.projectName).toBe(path.basename(projectDir))
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('matchProject rejects absolute local project paths outside allowed roots', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-root-'))
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-project-'))
    try {
      const client = new AdapterHttpClient('ws://127.0.0.1:3456', { allowedProjectRoots: [rootDir] })

      const result = await client.matchProject(projectDir)

      expect(result.project).toBeUndefined()
      expect(result.ambiguous).toBeUndefined()
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
      fs.rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('createSession throws on server error', async () => {
    await withRpcServer(
      () => ({ status: 400, body: { error: 'BAD_REQUEST', message: 'workDir required' } }),
      async ({ url }) => {
        const client = new AdapterHttpClient(url)
        await expect(client.createSession('')).rejects.toThrow('workDir required')
      },
    )
  })

  it('sessionExists returns false for deleted sessions', async () => {
    await withRpcServer(
      () => ({ status: 404, body: { error: 'NOT_FOUND' } }),
      async ({ url, requests }) => {
        const client = new AdapterHttpClient(url)

        await expect(client.sessionExists('deleted-session')).resolves.toBe(false)
        expect(requests[0]).toMatchObject({
          method: 'sessions.get',
          params: { path: { sessionId: 'deleted-session' } },
        })
      },
    )
  })

  it('getGitInfo calls GET /sessions/:id/git-info over RPC', async () => {
    await withRpcServer(
      () => ({
        body: {
          branch: 'main',
          repoName: 'beya',
          workDir: '/repo/beya',
          changedFiles: 2,
        },
      }),
      async ({ url, requests }) => {
        const client = new AdapterHttpClient(url)

        const gitInfo = await client.getGitInfo('session-123')

        expect(gitInfo.repoName).toBe('beya')
        expect(requests[0]).toMatchObject({
          method: 'sessions.gitinfo',
          params: { path: { sessionId: 'session-123' } },
        })
      },
    )
  })

  it('getTasksForSession calls GET /tasks/lists/:id over RPC', async () => {
    await withRpcServer(
      () => ({
        body: {
          tasks: [
            { id: '1', subject: 'Fix bug', status: 'in_progress' },
            { id: '2', subject: 'Write docs', status: 'pending' },
          ],
        },
      }),
      async ({ url, requests }) => {
        const client = new AdapterHttpClient(url)

        const tasks = await client.getTasksForSession('session-123')

        expect(tasks).toHaveLength(2)
        expect(tasks[0]?.status).toBe('in_progress')
        expect(requests[0]).toMatchObject({
          method: 'tasks.getlist',
          params: { path: { taskListId: 'session-123' } },
        })
      },
    )
  })
})
