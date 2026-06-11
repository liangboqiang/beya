import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { ExecutionModeRouter } from '../execution/executionModeRouter.js'
import { ExecutionSessionFacade } from '../execution/executionSessionFacade.js'
import { sessionService } from '../services/sessionService.js'
import type {
  ExecutionBackend,
  ExecutionBackendHost,
  PreparedExecutionSessionStart,
} from '../execution/types.js'

describe('execution routing', () => {
  afterEach(() => {
    mock.restore()
  })

  test('routes provider by default and local_cli explicitly', async () => {
    const providerCalls: PreparedExecutionSessionStart[] = []
    const localCalls: PreparedExecutionSessionStart[] = []
    const router = new ExecutionModeRouter(
      makeBackend(providerCalls),
      makeBackend(localCalls),
    )
    const host = {} as ExecutionBackendHost

    await router.startSession(makePreparedStart(), host)
    await router.startSession(makePreparedStart({ executionMode: 'local_cli' }), host)

    expect(providerCalls).toHaveLength(1)
    expect(localCalls).toHaveLength(1)
    expect(providerCalls[0]?.options?.executionMode).toBeUndefined()
    expect(localCalls[0]?.options?.executionMode).toBe('local_cli')
  })

  test('facade prepares launch context before delegating to the router', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beya-execution-facade-'))
    const routed: PreparedExecutionSessionStart[] = []
    const router = {
      startSession: mock((input: PreparedExecutionSessionStart) => {
        routed.push(input)
        return Promise.resolve()
      }),
    } as unknown as ExecutionModeRouter
    const facade = new ExecutionSessionFacade(router)
    spyOn(sessionService, 'getSessionLaunchInfo').mockResolvedValue(null as any)

    try {
      await facade.startSession(
        {
          sessionId: 'session-1',
          workDir: tmpDir,
          runtimeUrl: 'ws://127.0.0.1:3456/sessions/session-1/runtime',
          options: { executionMode: 'provider', model: 'model-a' },
        },
        {
          isSessionDeleted: () => false,
          hasSession: () => false,
        } as ExecutionBackendHost,
      )
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }

    expect(routed).toHaveLength(1)
    expect(routed[0]).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      requestedWorkDir: tmpDir,
      launchWorkDir: tmpDir,
      shouldResume: false,
      shouldReplacePlaceholder: false,
      launchInfo: null,
      options: { executionMode: 'provider', model: 'model-a' },
    }))
  })
})

function makeBackend(calls: PreparedExecutionSessionStart[]): ExecutionBackend {
  return {
    startSession: (input) => {
      calls.push(input)
      return Promise.resolve()
    },
  }
}

function makePreparedStart(
  options?: PreparedExecutionSessionStart['options'],
): PreparedExecutionSessionStart {
  return {
    sessionId: 'session-1',
    requestedWorkDir: 'F:\\workspace',
    launchWorkDir: 'F:\\workspace',
    runtimeUrl: 'ws://127.0.0.1:3456/sessions/session-1/runtime',
    options,
    launchInfo: null,
    launchRepository: undefined,
    shouldResume: false,
    shouldReplacePlaceholder: false,
  }
}
