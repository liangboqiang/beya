import type { ExecutionMode } from '../services/executionModeService.js'
import type { SelectedLocalCliRuntime } from '../services/localCliRuntimeService.js'
import type { PreparedSessionWorkspace } from '../services/repositoryLaunchService.js'
import type { LocalCliTurnHandle } from '../local-cli/types.js'
import type { RuntimeProfile } from '../runtime/protocol.js'

export type SessionStartOptions = {
  permissionMode?: string
  model?: string
  effort?: string
  thinking?: 'enabled' | 'adaptive' | 'disabled'
  providerId?: string | null
  localCliId?: string | null
  executionMode?: ExecutionMode
  metadata?: Record<string, unknown>
  runtimeProfile?: RuntimeProfile
}

export type SessionProcess = {
  runtimeKind: 'provider' | 'local_cli'
  proc?: ReturnType<typeof Bun.spawn>
  activeLocalCliTurn?: LocalCliTurnHandle
  localCliRuntime?: SelectedLocalCliRuntime
  localCliModel?: string
  runtimeProfile?: RuntimeProfile
  outputCallbacks: Array<(msg: any) => void>
  workDir: string
  permissionMode: string
  runtimeToken: string
  runtimeSocket: { send(data: string): void } | null
  pendingOutbound: string[]
  startupPending: boolean
  startupExitCode: number | null
  stdoutLines: string[]
  stderrLines: string[]
  outputDrain: Promise<void>
  runtimeMessages: any[]
  initMessage: any | null
  pendingPermissionRequests: Map<
    string,
    {
      toolName: string
      toolUseId?: string
      description?: string
      input: Record<string, unknown>
      permissionSuggestions?: unknown[]
    }
  >
}

export type ExecutionSessionLaunchInfo = {
  transcriptMessageCount: number
  customTitle?: string | null
  permissionMode?: string
  repository?: PreparedSessionWorkspace['repository']
} & Record<string, unknown>

export type PreparedExecutionSessionStart = {
  sessionId: string
  requestedWorkDir: string
  launchWorkDir: string
  runtimeUrl: string
  options?: SessionStartOptions
  launchInfo: ExecutionSessionLaunchInfo | null
  launchRepository: PreparedSessionWorkspace['repository'] | undefined
  shouldResume: boolean
  shouldReplacePlaceholder: boolean
}

export class ConversationStartupError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'WORKDIR_INVALID'
      | 'CLI_AUTH_REQUIRED'
      | 'CLI_SESSION_CONFLICT'
      | 'CLI_START_FAILED'
      | 'CLI_SPAWN_FAILED'
      | 'SESSION_DELETED',
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'ConversationStartupError'
  }
}

export type ExecutionBackendHost = {
  hasSession(sessionId: string): boolean
  isSessionDeleted(sessionId: string): boolean
  registerSession(sessionId: string, session: SessionProcess): void
  getSession(sessionId: string): SessionProcess | undefined
  deleteSession(sessionId: string): void
  buildProviderCliArgs(
    sessionId: string,
    runtimeUrl: string,
    shouldResume: boolean,
    options: SessionStartOptions | undefined,
    repository: PreparedSessionWorkspace['repository'] | undefined,
  ): string[]
  buildChildEnv(
    workDir: string,
    runtimeUrl: string | undefined,
    options: SessionStartOptions | undefined,
  ): Promise<Record<string, string>>
  getRuntimeTokenFromUrl(runtimeUrl: string): string
  readProcessOutputStream(
    sessionId: string,
    stream: ReadableStream | null | undefined,
    streamName: 'stdout' | 'stderr',
  ): Promise<void>
  handleProcessExit(
    sessionId: string,
    proc: ReturnType<typeof Bun.spawn>,
    code: number,
  ): Promise<void>
  waitForProcessOutputDrain(session: SessionProcess, timeoutMs?: number): Promise<void>
  buildStartupError(sessionId: string, exitCode: number): ConversationStartupError
  clearStaleLock(sessionId: string): boolean
  restartSession(
    sessionId: string,
    workDir: string,
    runtimeUrl: string,
    options: SessionStartOptions | undefined,
  ): Promise<void>
  buildCapturedProcessOutputDetail(session: SessionProcess | undefined): string
  summarizeRuntimeMessages(messages: any[]): unknown[]
}

export type ExecutionBackend = {
  startSession(
    input: PreparedExecutionSessionStart,
    host: ExecutionBackendHost,
  ): Promise<void>
}
