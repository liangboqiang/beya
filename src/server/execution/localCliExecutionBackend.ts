import { localCliProxy, type LocalCliProxy } from '../local-cli/localCliProxy.js'
import { resolveSelectedLocalCliRuntimeSync } from '../services/localCliRuntimeService.js'
import { toSelectedLocalCliRuntimeProfile } from '../runtime/runtimeResolver.js'
import { sessionService } from '../services/sessionService.js'
import type {
  LocalCliTurnHandle,
  LocalCliTurnInput,
} from '../local-cli/types.js'
import { resolveLocalCliStartupModel } from './modelSelection.js'
import {
  ConversationStartupError,
  type ExecutionBackend,
  type ExecutionBackendHost,
  type PreparedExecutionSessionStart,
  type SessionProcess,
} from './types.js'

export class LocalCliExecutionBackend implements ExecutionBackend {
  constructor(private readonly proxy: LocalCliProxy = localCliProxy) {}

  async startSession(
    input: PreparedExecutionSessionStart,
    host: ExecutionBackendHost,
  ): Promise<void> {
    const selectedLocalCliRuntime = resolveSelectedLocalCliRuntimeSync({
      id: input.options?.localCliId,
    })
    if (!selectedLocalCliRuntime) {
      throw new ConversationStartupError(
        'Local CLI execution mode is enabled, but no configured local CLI can be resolved. Choose and configure a local CLI in Settings > Execution Mode.',
        'CLI_START_FAILED',
        true,
      )
    }

    const localCliModel = resolveLocalCliStartupModel(
      selectedLocalCliRuntime,
      input.options?.model,
    )
    const session: SessionProcess = {
      runtimeKind: 'local_cli',
      localCliRuntime: selectedLocalCliRuntime,
      localCliModel,
      runtimeProfile:
        input.options?.runtimeProfile ??
        toSelectedLocalCliRuntimeProfile(selectedLocalCliRuntime, localCliModel),
      outputCallbacks: [],
      workDir: input.launchWorkDir,
      permissionMode: input.options?.permissionMode || 'default',
      runtimeToken: '',
      runtimeSocket: null,
      pendingOutbound: [],
      startupPending: false,
      startupExitCode: null,
      stdoutLines: [],
      stderrLines: [],
      outputDrain: Promise.resolve(),
      runtimeMessages: [],
      initMessage: {
        type: 'system',
        subtype: 'init',
        model: selectedLocalCliRuntime.displayName,
      },
      pendingPermissionRequests: new Map(),
    }

    host.registerSession(input.sessionId, session)

    if (input.shouldReplacePlaceholder || !input.launchInfo) {
      await sessionService.appendSessionMetadata(input.sessionId, {
        workDir: input.launchWorkDir,
        customTitle: input.launchInfo?.customTitle ?? null,
        repository: input.launchRepository,
        permissionMode: input.options?.permissionMode || input.launchInfo?.permissionMode,
        runtimeKind: 'local_cli',
        runtimeProviderId: null,
        runtimeLocalCliId: selectedLocalCliRuntime.id,
        ...(localCliModel ? { runtimeModelId: localCliModel } : {}),
        ...(input.options?.effort ? { effortLevel: input.options.effort } : {}),
      })
    }

    console.log(
      `[LocalCliExecutionBackend] Local CLI runtime ${selectedLocalCliRuntime.id} ready for ${input.sessionId}, cwd: ${input.launchWorkDir}`,
    )
  }

  startTurn(input: LocalCliTurnInput): LocalCliTurnHandle {
    return this.proxy.startTurn(input)
  }
}

export const localCliExecutionBackend = new LocalCliExecutionBackend()
