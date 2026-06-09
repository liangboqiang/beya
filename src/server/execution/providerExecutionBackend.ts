import { diagnosticsService } from '../services/diagnosticsService.js'
import { sessionService } from '../services/sessionService.js'
import type {
  ExecutionBackend,
  ExecutionBackendHost,
  PreparedExecutionSessionStart,
  SessionProcess,
} from './types.js'
import { ConversationStartupError } from './types.js'

const STARTUP_GRACE_MS = 3000

export class ProviderExecutionBackend implements ExecutionBackend {
  async startSession(
    input: PreparedExecutionSessionStart,
    host: ExecutionBackendHost,
  ): Promise<void> {
    if (!input.options?.providerId || !input.options?.model) {
      throw new ConversationStartupError(
        'Provider execution mode requires a resolved provider and model before startup.',
        'CLI_START_FAILED',
        true,
      )
    }

    const args = host.buildProviderCliArgs(
      input.sessionId,
      input.sdkUrl,
      input.shouldResume,
      input.options,
      input.launchRepository,
    )

    console.log(
      `[ProviderExecutionBackend] Starting agent runtime for ${input.sessionId}, cwd: ${input.launchWorkDir} (process.cwd()=${process.cwd()}, CALLER_DIR will be pinned to workDir)`,
    )

    const childEnv = await host.buildChildEnv(input.launchWorkDir, input.sdkUrl, input.options)

    let proc: ReturnType<typeof Bun.spawn>
    try {
      proc = Bun.spawn(args, {
        cwd: input.launchWorkDir,
        env: childEnv,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
    } catch (spawnErr) {
      void diagnosticsService.recordEvent({
        type: 'cli_spawn_failed',
        severity: 'error',
        sessionId: input.sessionId,
        summary: spawnErr instanceof Error ? spawnErr.message : String(spawnErr),
        details: {
          workDir: input.requestedWorkDir,
          permissionMode: input.options?.permissionMode || 'default',
          providerId: input.options?.providerId ?? null,
          model: input.options?.model ?? null,
          error: spawnErr,
        },
      })
      throw new ConversationStartupError(
        `Failed to spawn agent runtime in ${input.launchWorkDir}: ${
          spawnErr instanceof Error ? spawnErr.message : String(spawnErr)
        }`,
        'CLI_SPAWN_FAILED',
      )
    }

    const session: SessionProcess = {
      runtimeKind: 'sdk',
      runtimeProfile: input.options?.runtimeProfile,
      proc,
      outputCallbacks: [],
      workDir: input.launchWorkDir,
      permissionMode: input.options?.permissionMode || 'default',
      sdkToken: host.getSdkTokenFromUrl(input.sdkUrl),
      sdkSocket: null,
      pendingOutbound: [],
      startupPending: true,
      startupExitCode: null,
      stdoutLines: [],
      stderrLines: [],
      outputDrain: Promise.resolve(),
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    }
    host.registerSession(input.sessionId, session)

    session.outputDrain = Promise.all([
      host.readProcessOutputStream(input.sessionId, proc.stdout, 'stdout'),
      host.readProcessOutputStream(input.sessionId, proc.stderr, 'stderr'),
    ]).then(() => undefined)

    proc.exited.then((code) => {
      void host.handleProcessExit(input.sessionId, proc, code)
    })

    const earlyExitCode = await Promise.race([
      proc.exited,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), STARTUP_GRACE_MS),
      ),
    ])

    const startupExitCode = earlyExitCode ?? session.startupExitCode
    if (startupExitCode !== null) {
      await host.waitForProcessOutputDrain(session)
      const startupError = host.buildStartupError(input.sessionId, startupExitCode)
      host.deleteSession(input.sessionId)

      if (host.clearStaleLock(input.sessionId)) {
        console.log(
          `[ProviderExecutionBackend] Removed stale lock for ${input.sessionId}, retrying...`,
        )
        return host.restartSession(
          input.sessionId,
          input.requestedWorkDir,
          input.sdkUrl,
          input.options,
        )
      }

      console.error(
        `[ProviderExecutionBackend] Agent runtime exited with code ${startupExitCode} for ${input.sessionId}: ${startupError.message}`,
      )
      void diagnosticsService.recordEvent({
        type: 'cli_start_failed',
        severity: 'error',
        sessionId: input.sessionId,
        summary: startupError.message,
        details: {
          code: startupError.code,
          exitCode: startupExitCode,
          retryable: startupError.retryable,
          workDir: input.launchWorkDir,
          permissionMode: input.options?.permissionMode || 'default',
          providerId: input.options?.providerId ?? null,
          model: input.options?.model ?? null,
          capturedOutput: host.buildCapturedProcessOutputDetail(session),
          sdkMessages: host.summarizeSdkMessages(session.sdkMessages),
        },
      })
      throw startupError
    }

    session.startupPending = false

    if (input.shouldReplacePlaceholder || !input.launchInfo) {
      await sessionService.appendSessionMetadata(input.sessionId, {
        workDir: input.launchWorkDir,
        customTitle: input.launchInfo?.customTitle ?? null,
        repository: input.launchRepository,
        permissionMode: input.options?.permissionMode || input.launchInfo?.permissionMode,
      })
    }

    console.log(`[ProviderExecutionBackend] Agent runtime started successfully for ${input.sessionId}`)
  }
}

export const providerExecutionBackend = new ProviderExecutionBackend()
