import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import WebSocket from 'ws'
import {
  createRpcResourceCall,
  type JsonValue,
  RPC_PATH,
  type RpcMethod,
  type RpcResourceParams,
} from '../../src/generated/contracts/index.js'

export type RecentProject = {
  projectPath: string
  realPath: string
  projectName: string
  isGit: boolean
  repoName: string | null
  branch: string | null
  modifiedAt: string
  sessionCount: number
}

export type GitInfo = {
  branch: string | null
  repoName: string | null
  workDir: string
  changedFiles: number
}

export type SessionTask = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
}

export class AdapterHttpClient {
  readonly httpBaseUrl: string
  readonly rpcWebSocketUrl: string
  private readonly allowedProjectRoots: string[]
  /** Default timeout for RPC requests (30 seconds) */
  private static readonly DEFAULT_TIMEOUT_MS = 30_000

  constructor(wsUrl: string, options?: { allowedProjectRoots?: string[] }) {
    this.httpBaseUrl = wsUrl
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:')
      .replace(/\/$/, '')
    this.rpcWebSocketUrl = `${wsUrl.replace(/\/$/, '')}${RPC_PATH}`
    this.allowedProjectRoots = (options?.allowedProjectRoots ?? [])
      .map(resolveExistingProjectPath)
      .filter((value): value is string => Boolean(value))
  }

  async createSession(workDir: string): Promise<string> {
    const data = await this.requestResource<{ sessionId: string }>('sessions.create', {
      body: { workDir } as JsonValue,
    })
    try {
      return data.sessionId
    } catch {
      throw new Error('Failed to create session: missing session id')
    }
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    try {
      await this.requestResource('sessions.get', {
        path: { sessionId },
      })
      return true
    } catch (error) {
      if (error instanceof AdapterRpcError && error.status === 404) return false
      throw error
    }
  }

  async listRecentProjects(): Promise<RecentProject[]> {
    const data = await this.requestResource<{ projects: RecentProject[] }>('sessions.recentprojects')
    return data.projects
  }

  /**
   * Match a project by index (1-based) or fuzzy name from recent projects.
   * Returns { project, ambiguous[] } — ambiguous is set when multiple projects match.
   */
  async matchProject(query: string): Promise<{ project?: RecentProject; ambiguous?: RecentProject[] }> {
    const directPath = resolveExistingProjectPath(query)
    if (directPath) {
      if (!isPathWithinAllowedRoots(directPath, this.allowedProjectRoots)) {
        return {}
      }

      return {
        project: {
          projectPath: directPath,
          realPath: directPath,
          projectName: path.basename(directPath) || directPath,
          isGit: fs.existsSync(path.join(directPath, '.git')),
          repoName: null,
          branch: null,
          modifiedAt: new Date().toISOString(),
          sessionCount: 0,
        },
      }
    }

    const projects = await this.listRecentProjects()

    // Try as 1-based index
    const num = parseInt(query, 10)
    if (!isNaN(num) && num >= 1 && num <= projects.length && String(num) === query.trim()) {
      return { project: projects[num - 1] }
    }

    const q = query.toLowerCase()

    // Exact project name match
    const exact = projects.find(p => p.projectName.toLowerCase() === q)
    if (exact) return { project: exact }

    // Fuzzy: name or path contains query
    const matches = projects.filter(p =>
      p.projectName.toLowerCase().includes(q) ||
      p.realPath.toLowerCase().includes(q)
    )
    if (matches.length === 1) return { project: matches[0] }
    if (matches.length > 1) return { ambiguous: matches }

    return {}
  }

  async getGitInfo(sessionId: string): Promise<GitInfo> {
    return this.requestResource<GitInfo>('sessions.gitinfo', {
      path: { sessionId },
    })
  }

  async getTasksForSession(sessionId: string): Promise<SessionTask[]> {
    try {
      const data = await this.requestResource<{ tasks?: SessionTask[] }>('tasks.getlist', {
        path: { taskListId: sessionId },
      })
      return Array.isArray(data.tasks) ? data.tasks : []
    } catch (error) {
      if (error instanceof AdapterRpcError && error.status === 404) return []
      throw error
    }
  }

  private requestResource<T = unknown>(
    method: RpcMethod,
    params: RpcResourceParams = {},
    timeoutMs = AdapterHttpClient.DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const requestId = `adapter-rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const call = createRpcResourceCall(method, {
      headers: { 'Content-Type': 'application/json' },
      ...params,
    })

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.rpcWebSocketUrl)
      let settled = false
      const timer = setTimeout(() => {
        finish(() => reject(new Error(`RPC request timed out after ${timeoutMs}ms`)))
      }, timeoutMs)

      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ws.removeAllListeners()
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
        callback()
      }

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'rpc.request',
          id: requestId,
          method: call.method,
          params: call.params,
        }))
      })

      ws.on('message', (raw) => {
        const message = parseRpcMessage(raw.toString())
        if (!message) return
        if (message.type === 'rpc.connected' || message.type === 'rpc.pong') return
        if (message.id !== requestId) return

        if (message.type === 'rpc.error') {
          finish(() => reject(new Error(message.message || message.code || 'Adapter RPC failed')))
          return
        }

        if (message.type !== 'rpc.response') return
        if (message.status >= 400) {
          finish(() => reject(new AdapterRpcError(
            message.status,
            errorMessageFromBody(message.result) || `RPC request failed with status ${message.status}`,
          )))
          return
        }
        finish(() => resolve(message.result as T))
      })

      ws.on('error', (error) => {
        finish(() => reject(error))
      })

      ws.on('close', () => {
        finish(() => reject(new Error('RPC WebSocket closed before a response was received')))
      })
    })
  }
}

class AdapterRpcError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'AdapterRpcError'
  }
}

type RpcMessage =
  | { type: 'rpc.connected'; id?: string }
  | { type: 'rpc.pong'; id?: string }
  | { type: 'rpc.error'; id?: string; code?: string; message?: string }
  | { type: 'rpc.response'; id: string; status: number; result: unknown }

function parseRpcMessage(raw: string): RpcMessage | null {
  try {
    const parsed = JSON.parse(raw) as RpcMessage
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function errorMessageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  return typeof record.message === 'string'
    ? record.message
    : typeof record.error === 'string'
      ? record.error
      : null
}

function isPathWithinAllowedRoots(target: string, roots: string[]): boolean {
  if (roots.length === 0) return false

  for (const root of roots) {
    const relative = path.relative(root, target)
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return true
    }
  }

  return false
}

function resolveExistingProjectPath(query: string): string | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const expanded = trimmed === '~'
    ? os.homedir()
    : trimmed.startsWith('~/')
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed

  if (!path.isAbsolute(expanded)) return null

  try {
    const realPath = fs.realpathSync(expanded)
    return fs.statSync(realPath).isDirectory() ? realPath : null
  } catch {
    return null
  }
}
