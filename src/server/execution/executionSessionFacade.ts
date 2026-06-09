import * as fs from 'node:fs'

import { executionModeRouter, type ExecutionModeRouter } from './executionModeRouter.js'
import {
  ConversationStartupError,
  type ExecutionBackendHost,
  type SessionStartOptions,
} from './types.js'
import { sessionService } from '../services/sessionService.js'
import {
  isMaterializedWorktreeLaunch,
  prepareSessionWorkspace,
  shouldCreateWorktreeForSessionLaunch,
} from '../services/repositoryLaunchService.js'

export type ExecutionSessionStartRequest = {
  sessionId: string
  workDir: string
  sdkUrl: string
  options?: SessionStartOptions
}

export class ExecutionSessionFacade {
  constructor(private readonly router: ExecutionModeRouter = executionModeRouter) {}

  async startSession(
    request: ExecutionSessionStartRequest,
    host: ExecutionBackendHost,
  ): Promise<void> {
    const { sessionId, workDir, sdkUrl, options } = request
    if (host.isSessionDeleted(sessionId)) {
      throw new ConversationStartupError(
        `Session was deleted before startup completed: ${sessionId}`,
        'SESSION_DELETED',
      )
    }
    if (host.hasSession(sessionId)) return

    const launchInfo = await sessionService.getSessionLaunchInfo(sessionId)
    const shouldResume = !!launchInfo && launchInfo.transcriptMessageCount > 0
    const shouldReplacePlaceholder =
      !!launchInfo && launchInfo.transcriptMessageCount === 0
    const shouldCreateWorktree =
      !!launchInfo && shouldCreateWorktreeForSessionLaunch(launchInfo)
    const hasMaterializedWorktree =
      !!launchInfo && isMaterializedWorktreeLaunch(launchInfo)

    if (host.isSessionDeleted(sessionId)) {
      throw new ConversationStartupError(
        `Session was deleted before startup completed: ${sessionId}`,
        'SESSION_DELETED',
      )
    }

    assertWorkDir(workDir)

    if (shouldReplacePlaceholder) {
      await sessionService.clearSessionTranscript(sessionId, workDir)
    }

    let launchWorkDir = workDir
    let launchRepository = launchInfo?.repository
    if (shouldCreateWorktree && launchRepository?.worktree) {
      launchWorkDir = launchRepository.requestedWorkDir || launchRepository.repoRoot || workDir
    } else if (!shouldResume && launchRepository && !hasMaterializedWorktree) {
      const preparedWorkspace = await prepareSessionWorkspace(
        workDir,
        {
          branch: launchRepository.branch,
          worktree: false,
        },
        sessionId,
      )
      launchWorkDir = preparedWorkspace.workDir
      launchRepository = preparedWorkspace.repository
    }

    if (!shouldCreateWorktree && launchRepository?.worktree) {
      launchRepository = {
        ...launchRepository,
        worktree: false,
      }
    }

    assertWorkDir(launchWorkDir)

    await this.router.startSession(
      {
        sessionId,
        requestedWorkDir: workDir,
        launchWorkDir,
        sdkUrl,
        options,
        launchInfo,
        launchRepository,
        shouldResume,
        shouldReplacePlaceholder,
      },
      host,
    )
  }
}

function assertWorkDir(workDir: string): void {
  if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) {
    throw new ConversationStartupError(
      `Working directory does not exist or is not a directory: ${workDir}`,
      'WORKDIR_INVALID',
    )
  }
}

export const executionSessionFacade = new ExecutionSessionFacade()
