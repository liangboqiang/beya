/**
 * ConversationService — agent runtime process manager
 *
 * Each desktop session owns one agent runtime process. The process talks back to
 * the desktop server over the runtime WebSocket bridge, while the desktop UI talks
 * to the server over its own client WebSocket.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ProviderService } from './providerService.js'
import { diagnosticsService } from './diagnosticsService.js'
import { resolveSelectedLocalCliRuntimeSync } from './localCliRuntimeService.js'
import { executionSessionFacade } from '../execution/executionSessionFacade.js'
import { localCliExecutionBackend } from '../execution/localCliExecutionBackend.js'
import { sanitizeModelArgument } from '../execution/modelSelection.js'
import {
  ConversationStartupError,
  type ExecutionBackendHost,
  type SessionProcess,
  type SessionStartOptions,
} from '../execution/types.js'
import type { PreparedSessionWorkspace } from './repositoryLaunchService.js'
import {
  buildClaudeCliArgs,
  resolveClaudeCliLauncher,
} from '../../utils/desktopBundledCli.js'
import { getBeyaConfigHomeDir } from '../../utils/envUtils.js'
import { findCanonicalGitRoot } from '../../utils/git.js'
import { sanitizePath } from '../../utils/path.js'
import { getProcessEnvWithTerminalShellEnvironment } from '../../utils/terminalShellEnvironment.js'
import { attributionHeaderEnvForModel } from './attributionHeaderPolicy.js'
import { buildNetworkEnvironment, loadNetworkSettings } from './networkSettings.js'
import { logError } from '../../utils/log.js'
import {
  createImageMetadataText,
  maybeResizeAndDownsampleImageBuffer,
} from '../../utils/imageResizer.js'
import { serverEventBus } from '../events/eventBus.js'

const MAX_CAPTURED_PROCESS_LINES = 80
const MAX_CAPTURED_RUNTIME_MESSAGES = 40
const MAX_CAPTURED_RUNTIME_SUMMARY = 20
const CONTROL_READY_POLL_MS = 50
const AUTO_MEMORY_DIRNAME = 'memory'
const OPENAI_OAUTH_PROVIDER_ENV_KEY = 'BEYA_OPENAI_OAUTH_PROVIDER'
const OPENAI_CODEX_OAUTH_FILE_ENV_KEY = 'OPENAI_CODEX_OAUTH_FILE'
export const DESKTOP_CLI_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 6_000

type AttachmentRef = {
  type: 'file' | 'image'
  name?: string
  path?: string
  data?: string
  mimeType?: string
  isDirectory?: boolean
}

type UserContentBlock = Record<string, unknown>

type MaterializedAttachments = {
  pathPrefix: string
  imageBlocks: UserContentBlock[]
  imageMetadataTexts: string[]
}

export type PendingPermissionRequest = {
  requestId: string
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  description?: string
}

export { ConversationStartupError }

export class ConversationService {
  private sessions = new Map<string, SessionProcess>()
  private deletedSessions = new Set<string>()
  private providerService = new ProviderService()

  private buildSessionCliArgs(
    sessionId: string,
    runtimeUrl: string,
    shouldResume: boolean,
    options?: SessionStartOptions,
    repository?: PreparedSessionWorkspace['repository'],
  ): string[] {
    const dangerousMode = process.env.CLAUDE_DANGEROUS_MODE === '1'
    const worktreeArgs =
      !shouldResume && repository?.worktree
        ? [
            '--worktree',
            repository.worktreeSlug || repository.worktreeBranch || repository.branch,
            '--worktree-base-ref',
            repository.baseRef,
          ]
        : []

    return this.resolveCliArgs([
      '--print',
      '--verbose',
      '--runtime-url',
      runtimeUrl,
      '--enable-auth-status',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      // Desktop chat depends on partial assistant deltas; without this the
      // server only sees the completed assistant message at turn end.
      '--include-partial-messages',
      ...(shouldResume ? ['--resume', sessionId] : ['--session-id', sessionId]),
      ...worktreeArgs,
      '--replay-user-messages',
      ...this.getRuntimeArgs(options),
      ...this.getPermissionArgs(options?.permissionMode, dangerousMode),
    ], options)
  }

  async startSession(
    sessionId: string,
    workDir: string,
    runtimeUrl: string,
    options?: SessionStartOptions,
  ): Promise<void> {
    await executionSessionFacade.startSession(
      { sessionId, workDir, runtimeUrl, options },
      this.getExecutionBackendHost(),
    )
  }

  private getExecutionBackendHost(): ExecutionBackendHost {
    return {
      hasSession: (sessionId) => this.sessions.has(sessionId),
      isSessionDeleted: (sessionId) => this.deletedSessions.has(sessionId),
      registerSession: (sessionId, session) => this.sessions.set(sessionId, session),
      getSession: (sessionId) => this.sessions.get(sessionId),
      deleteSession: (sessionId) => {
        this.sessions.delete(sessionId)
      },
      buildProviderCliArgs: (
        sessionId,
        runtimeUrl,
        shouldResume,
        options,
        repository,
      ) => this.buildSessionCliArgs(
        sessionId,
        runtimeUrl,
        shouldResume,
        options,
        repository,
      ),
      buildChildEnv: (workDir, runtimeUrl, options) =>
        this.buildChildEnv(workDir, runtimeUrl, options),
      getRuntimeTokenFromUrl: (runtimeUrl) => this.getRuntimeTokenFromUrl(runtimeUrl),
      readProcessOutputStream: (sessionId, stream, streamName) =>
        this.readProcessOutputStream(sessionId, stream, streamName),
      handleProcessExit: (sessionId, proc, code) =>
        this.handleProcessExit(sessionId, proc, code),
      waitForProcessOutputDrain: (session, timeoutMs) =>
        this.waitForProcessOutputDrain(session, timeoutMs),
      buildStartupError: (sessionId, exitCode) =>
        this.buildStartupError(sessionId, exitCode),
      clearStaleLock: (sessionId) => this.clearStaleLock(sessionId),
      restartSession: (sessionId, workDir, runtimeUrl, options) =>
        this.startSession(sessionId, workDir, runtimeUrl, options),
      buildCapturedProcessOutputDetail: (session) =>
        this.buildCapturedProcessOutputDetail(session),
      summarizeRuntimeMessages: (messages) => this.summarizeRuntimeMessages(messages),
    }
  }

  onOutput(sessionId: string, callback: (msg: any) => void): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.outputCallbacks.push(callback)
    }
  }

  clearOutputCallbacks(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.outputCallbacks = []
    }
  }

  removeOutputCallback(sessionId: string, callback: (msg: any) => void): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.outputCallbacks = session.outputCallbacks.filter((entry) => entry !== callback)
  }

  getRecentRuntimeMessages(sessionId: string): any[] {
    return [...(this.sessions.get(sessionId)?.runtimeMessages ?? [])]
  }

  getSessionInitMessage(sessionId: string): any | null {
    return this.sessions.get(sessionId)?.initMessage ?? null
  }

  getSessionRuntimeProfile(sessionId: string) {
    return this.sessions.get(sessionId)?.runtimeProfile ?? null
  }

  async sendMessage(
    sessionId: string,
    content: string,
    attachments?: AttachmentRef[],
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (session?.runtimeKind === 'local_cli') {
      if (session.activeLocalCliTurn) return false
      void this.startLocalCliTurn(sessionId, session, content).catch((error) => {
        this.emitToSession(sessionId, {
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: error instanceof Error ? error.message : String(error),
          usage: { status: 'unavailable', source: 'local_cli' },
          session_id: sessionId,
        })
      })
      return true
    }

    const userContent = await this.buildUserContent(content, sessionId, attachments)
    return this.sendRuntimeMessage(sessionId, {
      type: 'user',
      message: {
        role: 'user',
        content: userContent,
      },
      parent_tool_use_id: null,
      session_id: '',
    })
  }

  private emitToSession(sessionId: string, message: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    for (const cb of session.outputCallbacks) {
      cb(message)
    }
  }

  private async startLocalCliTurn(
    sessionId: string,
    session: SessionProcess,
    content: string,
  ): Promise<void> {
    const runtime = session.localCliRuntime
    if (!runtime) {
      throw new Error('No local CLI runtime is selected for this session.')
    }

    const baseEnv = await this.buildChildEnv(session.workDir, undefined, {
      executionMode: 'local_cli',
      localCliId: runtime.id,
      model: session.localCliModel,
    })

    const turn = localCliExecutionBackend.startTurn({
      sessionId,
      runtime,
      workDir: session.workDir,
      model: session.localCliModel,
      content,
      baseEnv,
      redactOutput: (text) => this.redactProcessOutput(text),
      onCapturedLine: (streamName, line) => {
        const activeSession = this.sessions.get(sessionId)
        if (activeSession !== session) return
        const lines = streamName === 'stderr' ? session.stderrLines : session.stdoutLines
        lines.push(line)
        if (lines.length > MAX_CAPTURED_PROCESS_LINES) {
          lines.splice(0, lines.length - MAX_CAPTURED_PROCESS_LINES)
        }
      },
      onEvent: (event) => {
        const activeSession = this.sessions.get(sessionId)
        if (activeSession !== session) return
        this.emitToSession(sessionId, event)
      },
    })
    session.activeLocalCliTurn = turn
    session.outputDrain = turn.outputDrain

    try {
      await turn.done
    } finally {
      const activeSession = this.sessions.get(sessionId)
      if (activeSession === session && session.activeLocalCliTurn === turn) {
        session.activeLocalCliTurn = undefined
      }
    }
  }

  respondToPermission(
    sessionId: string,
    requestId: string,
    allowed: boolean,
    rule?: string,
    updatedInput?: Record<string, unknown>,
    feedback?: string,
  ): boolean {
    const session = this.sessions.get(sessionId)
    const pendingRequest = session?.pendingPermissionRequests.get(requestId)
    if (!session || !pendingRequest) {
      return false
    }
    session.pendingPermissionRequests.delete(requestId)

    return this.sendRuntimeMessage(sessionId, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: allowed
          ? {
              behavior: 'allow',
              updatedInput: updatedInput ?? {},
              ...(rule === 'always' && pendingRequest
                ? {
                    updatedPermissions: [
                      ...normalizeSessionPermissionUpdates(
                        pendingRequest.permissionSuggestions,
                        pendingRequest.toolName,
                      ),
                    ],
                  }
                : {}),
            }
          : { behavior: 'deny', message: feedback || 'User denied via UI' },
      },
    })
  }

  setPermissionMode(sessionId: string, mode: string): boolean {
    const sent = this.sendRuntimeMessage(sessionId, {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: {
        subtype: 'set_permission_mode',
        mode,
      },
    })
    if (sent) {
      const session = this.sessions.get(sessionId)
      if (session) session.permissionMode = mode
    }
    return sent
  }

  setMaxThinkingTokens(sessionId: string, maxThinkingTokens: number | null): boolean {
    return this.sendRuntimeMessage(sessionId, {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: {
        subtype: 'set_max_thinking_tokens',
        max_thinking_tokens: maxThinkingTokens,
      },
    })
  }

  setMaxThinkingTokensForActiveSessions(maxThinkingTokens: number | null): number {
    let sent = 0
    for (const sessionId of this.getActiveSessions()) {
      if (this.setMaxThinkingTokens(sessionId, maxThinkingTokens)) {
        sent += 1
      }
    }
    return sent
  }

  sendInterrupt(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (session?.runtimeKind === 'local_cli') {
      if (!session.activeLocalCliTurn) return false
      this.killProcess(sessionId, session, 'SIGTERM')
      return true
    }

    return this.sendRuntimeMessage(sessionId, {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'interrupt' },
    })
  }

  private isControlChannelReady(session: SessionProcess): boolean {
    return Boolean(session.runtimeSocket)
  }

  private async waitForControlChannelReady(
    sessionId: string,
    timeoutMs: number,
  ): Promise<void> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      const session = this.sessions.get(sessionId)
      if (!session) {
        throw new Error('CLI session is not running')
      }
      if (this.isControlChannelReady(session)) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, CONTROL_READY_POLL_MS))
    }

    throw new Error('Timed out waiting for CLI control channel to become ready')
  }

  async requestControl(
    sessionId: string,
    request: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    if (!this.sessions.has(sessionId)) {
      return Promise.reject(new Error('CLI session is not running'))
    }

    const startedAt = Date.now()
    await this.waitForControlChannelReady(sessionId, timeoutMs)
    const responseTimeoutMs = Math.max(1, timeoutMs - (Date.now() - startedAt))
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeOutputCallback(sessionId, handleOutput)
        reject(new Error(`Timed out waiting for ${String(request.subtype ?? 'control')} response`))
      }, responseTimeoutMs)

      const finish = (fn: () => void) => {
        clearTimeout(timeout)
        this.removeOutputCallback(sessionId, handleOutput)
        fn()
      }

      const handleOutput = (msg: any) => {
        if (
          msg?.type !== 'control_response' ||
          msg.response?.request_id !== requestId
        ) {
          return
        }

        if (msg.response.subtype === 'error') {
          finish(() => reject(new Error(String(msg.response.error || 'Control request failed'))))
          return
        }

        finish(() => resolve(
          msg.response.response && typeof msg.response.response === 'object'
            ? msg.response.response as Record<string, unknown>
            : {},
        ))
      }

      this.onOutput(sessionId, handleOutput)
      const sent = this.sendRuntimeMessage(sessionId, {
        type: 'control_request',
        request_id: requestId,
        request,
      })
      if (!sent) {
        finish(() => reject(new Error('CLI session is not running')))
      }
    })
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getSessionWorkDir(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    return session?.workDir || ''
  }

  updateSessionWorkDir(sessionId: string, workDir: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !workDir.trim()) return
    session.workDir = workDir
  }

  getSessionPermissionMode(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    return session?.permissionMode || 'default'
  }

  getPendingPermissionRequests(sessionId: string): PendingPermissionRequest[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []

    return Array.from(session.pendingPermissionRequests.entries()).map(([requestId, request]) => ({
      requestId,
      toolName: request.toolName,
      ...(request.toolUseId ? { toolUseId: request.toolUseId } : {}),
      input: request.input,
      ...(request.description ? { description: request.description } : {}),
    }))
  }

  authorizeRuntimeConnection(
    sessionId: string,
    token: string | null | undefined,
  ): boolean {
    const session = this.sessions.get(sessionId)
    return Boolean(session && token && token === session.runtimeToken)
  }

  attachRuntimeConnection(
    sessionId: string,
    socket: { send(data: string): void },
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    if (session.runtimeKind === 'local_cli') return false

    session.runtimeSocket = socket
    serverEventBus.emit('session.runtime.started', { sessionId })
    while (session.pendingOutbound.length > 0) {
      const line = session.pendingOutbound.shift()
      if (line) {
        socket.send(line)
      }
    }
    return true
  }

  detachRuntimeConnection(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.runtimeSocket = null
      serverEventBus.emit('session.runtime.stopped', { sessionId })
    }
  }

  handleRuntimePayload(sessionId: string, rawPayload: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const lines = rawPayload
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        session.runtimeMessages.push(msg)
        if (session.runtimeMessages.length > MAX_CAPTURED_RUNTIME_MESSAGES) {
          session.runtimeMessages.splice(0, session.runtimeMessages.length - MAX_CAPTURED_RUNTIME_MESSAGES)
        }
        const runtimeError = this.extractRuntimeErrorEvent(msg)
        if (runtimeError) {
          void diagnosticsService.recordEvent({
            type: runtimeError.type,
            severity: 'error',
            sessionId,
            summary: runtimeError.summary,
            details: runtimeError.details,
          })
        }
        if (msg?.type === 'system' && msg.subtype === 'init') {
          session.initMessage = msg
        }
        if (
          msg?.type === 'control_request' &&
          msg.request?.subtype === 'can_use_tool' &&
          typeof msg.request_id === 'string'
        ) {
          session.pendingPermissionRequests.set(msg.request_id, {
            toolName:
              typeof msg.request.tool_name === 'string'
                ? msg.request.tool_name
                : 'Unknown',
            toolUseId:
              typeof msg.request.tool_use_id === 'string' && msg.request.tool_use_id.trim()
                ? msg.request.tool_use_id
                : undefined,
            input:
              msg.request.input && typeof msg.request.input === 'object'
                ? (msg.request.input as Record<string, unknown>)
                : {},
            description:
              typeof msg.request.description === 'string' && msg.request.description.trim()
                ? msg.request.description
                : undefined,
            permissionSuggestions: Array.isArray(msg.request.permission_suggestions)
              ? msg.request.permission_suggestions
              : undefined,
          })
        }
        if (
          (msg?.type === 'control_cancel_request' || msg?.type === 'control_response') &&
          typeof msg.request_id === 'string'
        ) {
          session.pendingPermissionRequests.delete(msg.request_id)
        }
        if (
          msg?.type === 'control_response' &&
          typeof msg.response?.request_id === 'string'
        ) {
          session.pendingPermissionRequests.delete(msg.response.request_id)
        }
        for (const cb of session.outputCallbacks) {
          cb(msg)
        }
      } catch {
        console.warn(
          `[ConversationService] Ignoring malformed runtime payload for ${sessionId}`,
        )
      }
    }
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    this.sessions.delete(sessionId)
    this.killProcess(sessionId, session)
  }

  async stopSessionAndWait(
    sessionId: string,
    timeoutMs = DESKTOP_CLI_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    this.sessions.delete(sessionId)
    await this.stopProcessAndWait(sessionId, session, timeoutMs)
  }

  stopAllSessions(): void {
    for (const sessionId of this.getActiveSessions()) {
      this.stopSession(sessionId)
    }
  }

  async stopAllSessionsAndWait(
    timeoutMs = DESKTOP_CLI_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  ): Promise<void> {
    const activeSessions = Array.from(this.sessions.entries())
    if (activeSessions.length === 0) return

    this.sessions.clear()
    await Promise.all(
      activeSessions.map(([sessionId, session]) =>
        this.stopProcessAndWait(sessionId, session, timeoutMs),
      ),
    )
  }

  private async stopProcessAndWait(
    sessionId: string,
    session: SessionProcess,
    timeoutMs: number,
  ): Promise<void> {
    this.killProcess(sessionId, session, 'SIGTERM')

    const proc = session.proc ?? session.activeLocalCliTurn?.proc
    if (!proc) return

    const exited = await Promise.race([
      proc.exited.then(() => true, () => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ])
    if (!exited) {
      this.killProcess(sessionId, session, 'SIGKILL')
      await Promise.race([
        proc.exited.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ])
    }
    await this.waitForProcessOutputDrain(session, timeoutMs)
  }

  private killProcess(
    sessionId: string,
    session: SessionProcess,
    signal?: NodeJS.Signals,
  ): void {
    const proc = session.proc ?? session.activeLocalCliTurn?.proc
    if (!proc) return
    try {
      proc.kill(signal)
    } catch (error) {
      console.warn(
        `[ConversationService] Failed to kill agent runtime process for ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  markSessionDeleted(sessionId: string): void {
    this.deletedSessions.add(sessionId)
    this.stopSession(sessionId)
  }

  markSessionsDeleted(sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      this.markSessionDeleted(sessionId)
    }
  }

  unmarkSessionDeleted(sessionId: string): void {
    this.deletedSessions.delete(sessionId)
  }

  unmarkSessionsDeleted(sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      this.unmarkSessionDeleted(sessionId)
    }
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  private async readProcessOutputStream(
    sessionId: string,
    stream: ReadableStream | null | undefined,
    streamName: 'stdout' | 'stderr',
  ): Promise<void> {
    if (!stream) return

    const reader = stream.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        if (!text.trim()) continue

        const session = this.sessions.get(sessionId)
        if (session) {
          for (const line of text
            .split('\n')
            .map((entry) => entry.trim())
            .filter(Boolean)) {
            const lines =
              streamName === 'stderr' ? session.stderrLines : session.stdoutLines
            lines.push(this.redactProcessOutput(line))
            if (lines.length > MAX_CAPTURED_PROCESS_LINES) {
              lines.splice(0, lines.length - MAX_CAPTURED_PROCESS_LINES)
            }
          }
        }

        const logLine = this.redactProcessOutput(text.trim())
        if (streamName === 'stderr') {
          console.error(`[AgentRuntime:${sessionId}:stderr] ${logLine}`)
        } else {
          console.log(`[AgentRuntime:${sessionId}:stdout] ${logLine}`)
        }
      }
    } catch {
      // Process output read failures should not kill the session.
    }
  }

  private async waitForProcessOutputDrain(
    session: SessionProcess,
    timeoutMs = 250,
  ): Promise<void> {
    const outputDrain = session.outputDrain ?? Promise.resolve()
    await Promise.race([
      outputDrain.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }

  private sendRuntimeMessage(
    sessionId: string,
    payload: Record<string, unknown>,
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    if (session.runtimeKind === 'local_cli') return false

    const line = JSON.stringify(payload) + '\n'
    if (session.runtimeSocket) {
      session.runtimeSocket.send(line)
    } else {
      session.pendingOutbound.push(line)
    }
    return true
  }

  private async handleProcessExit(
    sessionId: string,
    proc: ReturnType<typeof Bun.spawn>,
    code: number,
  ): Promise<void> {
    console.log(
      `[ConversationService] Agent runtime process for ${sessionId} exited with code ${code}`,
    )

    const activeSession = this.sessions.get(sessionId)
    if (activeSession?.proc === proc) {
      if (activeSession.startupPending) {
        activeSession.startupExitCode = code
        return
      }
      await this.waitForProcessOutputDrain(activeSession)
      const exitError = this.buildRuntimeExitMessage(sessionId, code)
      void diagnosticsService.recordEvent({
        type: 'cli_runtime_exit',
        severity: 'error',
        sessionId,
        summary: exitError,
        details: {
          exitCode: code,
          workDir: activeSession.workDir,
          permissionMode: activeSession.permissionMode,
          capturedOutput: this.buildCapturedProcessOutputDetail(activeSession),
          runtimeMessages: this.summarizeRuntimeMessages(activeSession.runtimeMessages),
        },
      })
      for (const cb of activeSession.outputCallbacks) {
        cb({
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: exitError,
          usage: {
            status: 'unavailable',
            source: activeSession.runtimeKind === 'local_cli' ? 'local_cli' : 'provider',
          },
          session_id: sessionId,
        })
      }
      this.sessions.delete(sessionId)
      serverEventBus.emit('session.runtime.stopped', { sessionId })
    }
  }

  private getPermissionArgs(
    mode: string | undefined,
    dangerousMode: boolean,
  ): string[] {
    if (dangerousMode) {
      return ['--dangerously-skip-permissions']
    }

    const resolvedMode = mode || 'default'
    if (resolvedMode === 'bypassPermissions') {
      return ['--dangerously-skip-permissions']
    }

    const args = ['--permission-mode', resolvedMode]
    return args
  }

  private getRuntimeArgs(options: SessionStartOptions | undefined): string[] {
    const args: string[] = []

    if (options?.model) {
      const sanitizedModel = sanitizeModelArgument(options.model)
      if (sanitizedModel) args.push('--model', sanitizedModel)
    }

    if (options?.effort) {
      args.push('--effort', options.effort)
    }

    if (options?.thinking) {
      args.push('--thinking', options.thinking)
    }

    return args
  }

  private async buildChildEnv(
    workDir: string,
    runtimeUrl?: string,
    options?: SessionStartOptions,
  ): Promise<Record<string, string>> {
    // Provider isolation: when Desktop has its own provider config/index,
    // strip inherited provider env vars so the child CLI reads fresh values
    // from ~/.beya/beya/settings.json instead of stale process.env.
    //
    // If the user never configured a Desktop provider and only launched the
    // app/server with ANTHROPIC_* env vars, keep those env vars so Windows
    // dev-mode and env-only setups can still authenticate successfully.
    const PROVIDER_ENV_KEYS = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
      'BEYA_SEND_DISABLED_THINKING',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
      'CLAUDE_CODE_ATTRIBUTION_HEADER',
      'CLAUDE_CODE_MODEL_CONTEXT_WINDOWS',
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'CODEX_API_KEY',
      OPENAI_OAUTH_PROVIDER_ENV_KEY,
      OPENAI_CODEX_OAUTH_FILE_ENV_KEY,
    ] as const

    const cleanEnv = await getProcessEnvWithTerminalShellEnvironment()
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN
    if (
      options?.executionMode === 'local_cli' ||
      this.shouldStripInheritedProviderEnv(options?.providerId)
    ) {
      for (const key of PROVIDER_ENV_KEYS) {
        delete cleanEnv[key]
      }
    }

    let desktopServerUrl: string | undefined
    if (runtimeUrl) {
      try {
        const parsed = new URL(runtimeUrl)
        desktopServerUrl = `http://${parsed.host}`
      } catch {
        desktopServerUrl = undefined
      }
    }

    const explicitProviderEnv =
      options?.executionMode !== 'local_cli' && typeof options?.providerId === 'string'
        ? await this.providerService.getProviderRuntimeEnv(options.providerId)
        : null
    const selectedLocalCliEnv = options?.executionMode === 'local_cli'
      ? { BEYA_EXECUTION_MODE: 'local_cli' }
      : {}
    const networkEnv = buildNetworkEnvironment(await loadNetworkSettings())
    if (explicitProviderEnv && options?.model?.trim()) {
      explicitProviderEnv.ANTHROPIC_MODEL = options.model.trim()
    }
    const attributionHeaderEnv = attributionHeaderEnvForModel(
      options?.model?.trim() ||
        explicitProviderEnv?.ANTHROPIC_MODEL ||
        cleanEnv.ANTHROPIC_MODEL,
    )

    const cliDiagnosticsPath = diagnosticsService.getCliDiagnosticsPath()
    try {
      fs.mkdirSync(path.dirname(cliDiagnosticsPath), { recursive: true })
    } catch {
      // Diagnostics must never block session startup.
    }

    return {
      ...cleanEnv,
      CLAUDE_CODE_ENABLE_TASKS: '1',
      CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
      // Desktop must fail stuck provider streams instead of leaving the UI running forever.
      CLAUDE_ENABLE_STREAM_WATCHDOG: cleanEnv.CLAUDE_ENABLE_STREAM_WATCHDOG || '1',
      CLAUDE_CODE_DIAGNOSTICS_FILE: cliDiagnosticsPath,
      CLAUDE_COWORK_MEMORY_PATH_OVERRIDE: this.resolveDesktopAutoMemoryPath(workDir),
      CALLER_DIR: workDir,
      PWD: workDir,
      ...(runtimeUrl
        ? { BEYA_COMPUTER_USE_HOST_BUNDLE_ID: 'cn.edu.tju.apvic.beya' }
        : {}),
      ...(desktopServerUrl
        ? { BEYA_DESKTOP_SERVER_URL: desktopServerUrl }
        : {}),
      ...(runtimeUrl
        ? {
            BEYA_DESKTOP_AWAIT_MCP: '1',
            BEYA_DESKTOP_AWAIT_MCP_TIMEOUT_MS: '5000',
          }
        : {}),
      // Tell the CLI entrypoint to skip project .env loading. Provider env
      // should come from Desktop-managed config or inherited launch env, not
      // be reintroduced from the repo's .env file.
      BEYA_SKIP_DOTENV: '1',
      ...(explicitProviderEnv
        ? { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' }
        : {}),
      ...this.buildRuntimeMetadataEnv(options?.metadata),
      ...(explicitProviderEnv ?? {}),
      ...selectedLocalCliEnv,
      ...networkEnv,
      ...attributionHeaderEnv,
    }
  }

  private buildRuntimeMetadataEnv(
    metadata: Record<string, unknown> | undefined,
  ): Record<string, string> {
    if (!metadata || Object.keys(metadata).length === 0) {
      return {}
    }
    try {
      return {
        BEYA_RUNTIME_METADATA_JSON: JSON.stringify(metadata),
      }
    } catch {
      return {}
    }
  }

  private shouldStripInheritedProviderEnv(providerId?: string | null): boolean {
    if (typeof providerId === 'string' && providerId.trim()) {
      return true
    }

    const configDir =
      process.env.BEYA_CONFIG_DIR ||
      path.join(os.homedir(), '.beya')
    const beyaDir = path.join(configDir, 'beya')
    return (
      fs.existsSync(path.join(beyaDir, 'providers.json')) ||
      fs.existsSync(path.join(beyaDir, 'settings.json'))
    )
  }

  private resolveDesktopAutoMemoryPath(workDir: string): string {
    const memoryProjectRoot = fs.existsSync(workDir)
      ? findCanonicalGitRoot(workDir) ?? workDir
      : workDir
    return (
      path.join(
        getBeyaConfigHomeDir(),
        'projects',
        sanitizePath(memoryProjectRoot),
        AUTO_MEMORY_DIRNAME,
      ) + path.sep
    ).normalize('NFC')
  }

  private resolveCliArgs(baseArgs: string[], options?: SessionStartOptions): string[] {
    const executionMode = options?.executionMode ?? 'provider'
    const selectedLocalCliRuntime = executionMode === 'local_cli'
      ? resolveSelectedLocalCliRuntimeSync({ id: options?.localCliId })
      : null
    const selectedSdkCompatibleCliPath = selectedLocalCliRuntime?.id === 'claude'
      ? selectedLocalCliRuntime.launchPath
      : null
    const launcher = resolveClaudeCliLauncher({
      cliPath: selectedSdkCompatibleCliPath ?? process.env.BEYA_CLI_PATH ?? process.env.CLAUDE_CLI_PATH,
      execPath: process.execPath,
    })

    if (!launcher) {
      if (process.platform === 'win32') {
        return [
          process.execPath,
          '--preload',
          path.resolve(import.meta.dir, '../../../preload.ts'),
          path.resolve(import.meta.dir, '../../entrypoints/cli.tsx'),
          ...baseArgs,
        ]
      }
      return [path.resolve(import.meta.dir, '../../../bin/beya'), ...baseArgs]
    }

    return buildClaudeCliArgs(launcher, baseArgs, process.env.BEYA_APP_ROOT ?? process.env.CLAUDE_APP_ROOT)
  }

  private clearStaleLock(sessionId: string): boolean {
    const lockDir = path.join(
      process.env.BEYA_CONFIG_DIR || path.join(os.homedir(), '.beya'),
      '.lock',
    )
    const lockFile = path.join(lockDir, sessionId)
    if (!fs.existsSync(lockFile)) {
      return false
    }

    try {
      fs.unlinkSync(lockFile)
      return true
    } catch {
      return false
    }
  }

  private buildStartupError(
    sessionId: string,
    exitCode: number,
  ): ConversationStartupError {
    const session = this.sessions.get(sessionId)
    const capturedOutput = this.buildCapturedProcessOutputDetail(session)
    const recentMessages = session?.runtimeMessages ?? []
    const resultMessage = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'result' && msg.is_error)
    const assistantApiError = [...recentMessages]
      .reverse()
      .find((msg) => this.isAssistantApiErrorMessage(msg))
    const authStatus = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'auth_status')
    const detail =
      this.extractStartupDetail(resultMessage) ||
      this.extractAssistantApiErrorDetail(assistantApiError) ||
      this.extractStartupDetail(authStatus) ||
      capturedOutput

    if (
      /(not logged in|run \/login|sign in again|login required|unauthenticated|logged_out)/i.test(
        detail,
      )
    ) {
      return new ConversationStartupError(
        'Desktop chat could not start because Beya is not authenticated. Run `./bin/beya /login` or provide valid API credentials, then retry.',
        'CLI_AUTH_REQUIRED',
      )
    }

    if (/session id .*already in use/i.test(detail)) {
      return new ConversationStartupError(
        `Session ${sessionId} is already in use by another agent runtime process or transcript.`,
        'CLI_SESSION_CONFLICT',
        true,
      )
    }

    const normalizedDetail = detail.trim()
    return new ConversationStartupError(
      normalizedDetail
        ? `Agent runtime exited during startup (code ${exitCode}): ${normalizedDetail}`
        : `Agent runtime exited during startup with code ${exitCode}; no runtime stderr/stdout or runtime error payload was captured before exit.`,
      'CLI_START_FAILED',
      true,
    )
  }

  private buildRuntimeExitMessage(sessionId: string, exitCode: number): string {
    const session = this.sessions.get(sessionId)
    const capturedOutput = this.buildCapturedProcessOutputDetail(session)
    const recentMessages = session?.runtimeMessages ?? []
    const resultMessage = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'result' && msg.is_error)
    const assistantApiError = [...recentMessages]
      .reverse()
      .find((msg) => this.isAssistantApiErrorMessage(msg))
    const authStatus = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'auth_status')
    const detail =
      this.extractStartupDetail(resultMessage) ||
      this.extractAssistantApiErrorDetail(assistantApiError) ||
      this.extractStartupDetail(authStatus) ||
      capturedOutput

    return detail
      ? `Agent runtime exited unexpectedly (code ${exitCode}): ${detail}`
      : `Agent runtime exited unexpectedly with code ${exitCode}; no runtime stderr/stdout or runtime error payload was captured before exit.`
  }

  private buildCapturedProcessOutputDetail(
    session: SessionProcess | undefined,
  ): string {
    if (!session) return ''

    const stderrText = (session.stderrLines ?? []).join('\n').trim()
    const stdoutText = (session.stdoutLines ?? []).join('\n').trim()

    if (stderrText && stdoutText) {
      return `stderr:\n${stderrText}\nstdout:\n${stdoutText}`
    }

    return stderrText || stdoutText
  }

  private redactProcessOutput(line: string): string {
    return line
      .replace(/(ANTHROPIC_(?:API_KEY|AUTH_TOKEN)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
      .replace(/((?:api[_-]?key|auth[_-]?token|access[_-]?token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]')
  }

  private extractStartupDetail(message: any): string {
    if (!message) return ''

    if (typeof message.result === 'string') return message.result
    if (typeof message.status === 'string') return message.status
    if (typeof message.message === 'string') return message.message

    if (Array.isArray(message?.errors)) {
      return message.errors
        .filter((value: unknown): value is string => typeof value === 'string')
        .join('\n')
    }

    return ''
  }

  private isAssistantApiErrorMessage(message: any): boolean {
    return (
      message?.type === 'assistant' &&
      (message.isApiErrorMessage === true || typeof message.error === 'string')
    )
  }

  private extractAssistantApiErrorDetail(message: any): string {
    if (!this.isAssistantApiErrorMessage(message)) return ''

    const text = this.extractAssistantText(message)
    const error = typeof message.error === 'string' ? message.error : ''
    if (text && error) return `${error}: ${text}`
    return text || error
  }

  private extractAssistantText(message: any): string {
    const content = message?.message?.content
    if (!Array.isArray(content)) return ''
    const textBlock = content.find(
      (block: unknown): block is { type: string; text: string } =>
        !!block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    return textBlock?.text || ''
  }

  private extractRuntimeErrorEvent(message: any): {
    type: string
    summary: string
    details: Record<string, unknown>
  } | null {
    if (this.isAssistantApiErrorMessage(message)) {
      const summary = this.redactProcessOutput(
        this.extractAssistantApiErrorDetail(message) || 'Assistant API error',
      )
      return {
        type: 'sdk_api_error',
        summary,
        details: {
          runtimeType: message.type,
          error: typeof message.error === 'string' ? message.error : undefined,
          isApiErrorMessage: message.isApiErrorMessage === true,
          messageText: this.extractAssistantText(message)
            ? this.redactProcessOutput(this.extractAssistantText(message))
            : undefined,
          errorDetails:
            typeof message.errorDetails === 'string'
              ? this.redactProcessOutput(message.errorDetails)
              : undefined,
        },
      }
    }

    if (message?.type === 'result' && message.is_error) {
      const summary = this.redactProcessOutput(
        this.extractStartupDetail(message) || 'Runtime result error',
      )
      return {
        type: 'sdk_result_error',
        summary,
        details: {
          runtimeType: message.type,
          subtype: message.subtype,
          isError: true,
          result:
            typeof message.result === 'string'
              ? this.redactProcessOutput(message.result)
              : undefined,
          status:
            typeof message.status === 'string'
              ? this.redactProcessOutput(message.status)
              : undefined,
          usage: message.usage,
        },
      }
    }

    return null
  }

  private summarizeRuntimeMessages(messages: any[]): unknown[] {
    return messages.slice(-MAX_CAPTURED_RUNTIME_SUMMARY).map((message) => {
      if (!message || typeof message !== 'object') {
        return message
      }
      const content = Array.isArray(message.message?.content)
        ? message.message.content.map((block: unknown) => {
            if (!block || typeof block !== 'object') return block
            const typedBlock = block as Record<string, unknown>
            return {
              type: typedBlock.type,
              text:
                typeof typedBlock.text === 'string'
                  ? this.redactProcessOutput(typedBlock.text)
                  : undefined,
            }
          })
        : undefined
      return {
        type: message.type,
        subtype: message.subtype,
        is_error: message.is_error,
        status: typeof message.status === 'string' ? message.status : undefined,
        result: typeof message.result === 'string' ? this.redactProcessOutput(message.result) : undefined,
        error: typeof message.error === 'string' ? this.redactProcessOutput(message.error) : undefined,
        errorDetails:
          typeof message.errorDetails === 'string'
            ? this.redactProcessOutput(message.errorDetails)
            : undefined,
        message: typeof message.message === 'string' ? this.redactProcessOutput(message.message) : undefined,
        content,
      }
    })
  }

  private async buildUserContent(
    content: string,
    sessionId: string,
    attachments?: AttachmentRef[],
  ): Promise<UserContentBlock[]> {
    const materialized = await this.materializeAttachments(sessionId, attachments)
    const trimmed = content.trim()
    const text = materialized.pathPrefix
      ? `${materialized.pathPrefix}${trimmed || 'Please analyze the attached files.'}`.trim()
      : trimmed

    const blocks: UserContentBlock[] = text
      ? [{ type: 'text', text }]
      : materialized.imageBlocks.length > 0
        ? [{ type: 'text', text: 'Please analyze the attached image.' }]
        : []

    blocks.push(...materialized.imageBlocks)
    for (const metadataText of materialized.imageMetadataTexts) {
      blocks.push({ type: 'text', text: metadataText })
    }

    return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }]
  }

  private async materializeAttachments(
    sessionId: string,
    attachments?: AttachmentRef[],
  ): Promise<MaterializedAttachments> {
    const empty = (): MaterializedAttachments => ({
      pathPrefix: '',
      imageBlocks: [],
      imageMetadataTexts: [],
    })

    if (!attachments || attachments.length === 0) {
      return empty()
    }

    const uploadDir = path.join(
      process.env.BEYA_CONFIG_DIR || path.join(os.homedir(), '.beya'),
      'uploads',
      sessionId,
    )

    const savedPaths: string[] = []
    const imageBlocks: UserContentBlock[] = []
    const imageMetadataTexts: string[] = []
    for (const attachment of attachments) {
      if (this.shouldInlineImageAttachment(attachment)) {
        const image = await this.materializeImageAttachment(attachment, uploadDir)
        if (image) {
          imageBlocks.push(image.block)
          if (image.metadataText) imageMetadataTexts.push(image.metadataText)
          continue
        }
      }

      if (attachment.path) {
        savedPaths.push(attachment.path)
        continue
      }

      if (!attachment.data) continue

      const parsed = this.parseAttachmentData(attachment.data)
      if (!parsed) continue

      const ext = this.getAttachmentExtension({
        ...attachment,
        mimeType: attachment.mimeType ?? parsed.mimeType,
      })
      const fileName = this.sanitizeAttachmentName(attachment.name, attachment.type, ext)
      const outPath = this.writeUploadAttachment(uploadDir, fileName, parsed.payload)
      savedPaths.push(outPath)
    }

    return {
      pathPrefix: savedPaths.length > 0
        ? savedPaths.map((filePath) => `@"${filePath}"`).join(' ') + ' '
        : '',
      imageBlocks,
      imageMetadataTexts,
    }
  }

  private parseAttachmentData(data: string): { payload: Buffer; mimeType?: string } | null {
    const match = data.match(/^data:([^;,]+)?;base64,(.*)$/)
    const encoded = match ? match[2] : data

    try {
      return {
        payload: Buffer.from(encoded ?? '', 'base64'),
        mimeType: match?.[1],
      }
    } catch {
      return null
    }
  }

  private async materializeImageAttachment(
    attachment: AttachmentRef,
    uploadDir: string,
  ): Promise<{ block: UserContentBlock; metadataText?: string } | null> {
    const source = this.readImageAttachmentPayload(attachment)
    if (!source) {
      return null
    }

    try {
      const resized = await maybeResizeAndDownsampleImageBuffer(
        source.payload,
        source.payload.length,
        source.ext,
      )
      const normalizedExt = this.normalizeImageExtension(resized.mediaType)
      const storedName = this.replaceFileExtension(
        this.sanitizeAttachmentName(attachment.name, attachment.type, normalizedExt),
        normalizedExt,
      )
      const sourcePath = source.sourcePath ?? this.writeUploadAttachment(
        uploadDir,
        storedName,
        resized.buffer,
      )
      const metadataText = resized.dimensions
        ? createImageMetadataText(resized.dimensions, sourcePath)
        : sourcePath
          ? `[Image source: ${sourcePath}]`
          : undefined

      return {
        block: {
          type: 'image',
          source: {
            type: 'base64',
            media_type: `image/${normalizedExt}`,
            data: resized.buffer.toString('base64'),
          },
        },
        metadataText: metadataText ?? undefined,
      }
    } catch (error) {
      logError(error)
      console.warn(
        `[ConversationService] Failed to inline image attachment ${attachment.name ?? '<unnamed>'}; falling back to file path`,
      )
      return null
    }
  }

  private readImageAttachmentPayload(
    attachment: AttachmentRef,
  ): { payload: Buffer; ext: string; sourcePath?: string } | null {
    if (attachment.data) {
      const parsed = this.parseAttachmentData(attachment.data)
      if (!parsed) return null
      return {
        payload: parsed.payload,
        ext: this.getAttachmentExtension({
          ...attachment,
          mimeType: attachment.mimeType ?? parsed.mimeType,
        }),
      }
    }

    if (!attachment.path || attachment.isDirectory) {
      return null
    }

    try {
      return {
        payload: fs.readFileSync(attachment.path),
        ext: this.getAttachmentExtension(attachment),
        sourcePath: attachment.path,
      }
    } catch (error) {
      logError(error)
      return null
    }
  }

  private shouldInlineImageAttachment(attachment: AttachmentRef): boolean {
    if (attachment.isDirectory) return false
    if (attachment.type === 'image') return true
    if (attachment.mimeType?.startsWith('image/')) return true
    const candidate = attachment.path ?? attachment.name ?? ''
    return /\.(png|jpe?g|gif|webp)$/i.test(candidate)
  }

  private writeUploadAttachment(uploadDir: string, fileName: string, payload: Buffer): string {
    fs.mkdirSync(uploadDir, { recursive: true })
    const outPath = path.join(uploadDir, `${crypto.randomUUID()}-${fileName}`)
    fs.writeFileSync(outPath, payload)
    return outPath
  }

  private normalizeImageExtension(ext: string): string {
    const clean = ext.split('/').pop()?.split('+')[0]?.toLowerCase() || 'png'
    return clean === 'jpg' ? 'jpeg' : clean
  }

  private replaceFileExtension(fileName: string, ext: string): string {
    const cleanExt = this.normalizeImageExtension(ext)
    const base = fileName.replace(/\.[a-z0-9]+$/i, '')
    return `${base}.${cleanExt}`
  }

  private getAttachmentExtension(attachment: AttachmentRef): string {
    const byName = attachment.name?.match(/\.([a-z0-9]+)$/i)?.[1]
    if (byName) return byName

    const byPath = attachment.path?.match(/\.([a-z0-9]+)$/i)?.[1]
    if (byPath) return byPath

    const byMime = attachment.mimeType?.split('/')[1]?.split('+')[0]
    if (byMime) return byMime

    return attachment.type === 'image' ? 'png' : 'bin'
  }

  private sanitizeAttachmentName(
    name: string | undefined,
    type: AttachmentRef['type'],
    ext: string,
  ): string {
    const fallback = `${type}-attachment.${ext}`
    const normalized = (name || fallback).replace(/[^a-zA-Z0-9._-]/g, '_')
    return normalized || fallback
  }

  private getRuntimeTokenFromUrl(runtimeUrl: string): string {
    const url = new URL(runtimeUrl)
    return url.searchParams.get('token') || ''
  }
}

function normalizeSessionPermissionUpdates(
  suggestions: unknown[] | undefined,
  toolName: string,
) {
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    return suggestions.map((suggestion) => {
      if (!suggestion || typeof suggestion !== 'object') {
        return suggestion
      }
      return {
        ...suggestion,
        destination: 'session',
      }
    })
  }

  return [
    {
      type: 'addRules',
      rules: [{ toolName }],
      behavior: 'allow',
      destination: 'session',
    },
  ]
}

export const conversationService = new ConversationService()
