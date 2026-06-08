import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  __resetWebSocketHandlerStateForTests,
  closeSessionConnection,
  getActiveSessionIds,
  handleWebSocket,
  type WebSocketData,
} from '../ws/handler.js'
import { conversationService } from '../services/conversationService.js'
import { computerUseApprovalService } from '../services/computerUseApprovalService.js'
import { localCliRuntimeService } from '../services/localCliRuntimeService.js'
import { ProviderService } from '../services/providerService.js'
import { sessionService } from '../services/sessionService.js'
import { SettingsService } from '../services/settingsService.js'

function makeClientSocket(
  sessionId: string,
  purpose: WebSocketData['purpose'] = 'chat',
) {
  const sent: string[] = []
  return {
    data: {
      sessionId,
      connectedAt: Date.now(),
      channel: 'client',
      purpose,
      sdkToken: null,
      serverPort: 0,
      serverHost: '127.0.0.1',
    },
    send: mock((payload: string) => {
      sent.push(payload)
    }),
    close: mock(() => {}),
    sent,
  } as unknown as ServerWebSocket<WebSocketData> & { sent: string[] }
}

function sentMessages(ws: { sent: string[] }): unknown[] {
  return ws.sent.map((payload) => JSON.parse(payload))
}

function makeAvailableLocalCli() {
  return {
    id: 'codex',
    displayName: 'Codex CLI',
    command: 'codex',
    executablePath: 'codex.cmd',
    launchPath: 'codex.cmd',
    launchKind: 'selected' as const,
    source: 'path',
    available: true,
    supportsDesktopRuntime: true,
    version: '1.0.0',
    config: {},
    configFields: [],
    models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
    modelRoles: {
      primary: 'gpt-5-codex',
      fast: 'gpt-5-codex',
      balanced: 'gpt-5-codex',
      powerful: 'gpt-5-codex',
    },
    enabledModels: ['gpt-5-codex'],
  }
}

async function waitForAsyncHandlers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForCall(spy: { mock: { calls: unknown[] } }): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (spy.mock.calls.length > 0) return
    await waitForAsyncHandlers()
  }
}

async function waitForCall(fn: { mock: { calls: unknown[] } }): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (fn.mock.calls.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('WebSocket handler session isolation', () => {
  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  it('ignores stale disconnects from an older socket for the same session', () => {
    const sessionId = `duplicate-${crypto.randomUUID()}`
    const first = makeClientSocket(sessionId)
    const second = makeClientSocket(sessionId)
    const clearCallbacks = spyOn(conversationService, 'clearOutputCallbacks')
    const cancelComputerUse = spyOn(computerUseApprovalService, 'cancelSession')

    handleWebSocket.open(first)
    handleWebSocket.open(second)
    clearCallbacks.mockClear()
    cancelComputerUse.mockClear()

    handleWebSocket.close(first, 1000, 'stale tab closed')

    expect(getActiveSessionIds()).toContain(sessionId)
    expect(clearCallbacks).not.toHaveBeenCalled()
    expect(cancelComputerUse).not.toHaveBeenCalled()
  })

  it('closes and removes an active client socket when a session is deleted', () => {
    const sessionId = `delete-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const clearCallbacks = spyOn(conversationService, 'clearOutputCallbacks')
    const cancelComputerUse = spyOn(computerUseApprovalService, 'cancelSession')

    handleWebSocket.open(ws)

    expect(closeSessionConnection(sessionId, 'session deleted')).toBe(true)

    expect(getActiveSessionIds()).not.toContain(sessionId)
    expect(ws.close).toHaveBeenCalledWith(1000, 'session deleted')
    expect(clearCallbacks).toHaveBeenCalledWith(sessionId)
    expect(cancelComputerUse).toHaveBeenCalledWith(sessionId)
  })

  it('replays pending permission requests when a client reconnects', () => {
    const sessionId = `permission-reconnect-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    spyOn(conversationService, 'hasSession').mockReturnValue(true)
    spyOn(conversationService, 'onOutput').mockImplementation(() => {})
    spyOn(conversationService, 'removeOutputCallback').mockImplementation(() => {})
    spyOn(conversationService, 'getPendingPermissionRequests').mockReturnValue([
      {
        requestId: 'request-ask-1',
        toolName: 'AskUserQuestion',
        toolUseId: 'tool-ask-1',
        input: {
          questions: [
            {
              header: 'Scope',
              question: 'Which scope?',
              options: [{ label: 'A', description: 'First' }, { label: 'B', description: 'Second' }],
            },
          ],
        },
        description: 'Answer questions?',
      },
    ])

    handleWebSocket.open(ws)

    expect(ws.sent.map((payload) => JSON.parse(payload))).toContainEqual({
      type: 'permission_request',
      requestId: 'request-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
      input: {
        questions: [
          {
            header: 'Scope',
            question: 'Which scope?',
            options: [{ label: 'A', description: 'First' }, { label: 'B', description: 'Second' }],
          },
        ],
      },
      description: 'Answer questions?',
    })
  })

  it('does not replay pending permission requests on interaction response connections', () => {
    const sessionId = `permission-response-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId, 'interaction_response')
    spyOn(conversationService, 'hasSession').mockReturnValue(true)
    spyOn(conversationService, 'onOutput').mockImplementation(() => {})
    spyOn(conversationService, 'removeOutputCallback').mockImplementation(() => {})
    spyOn(conversationService, 'getPendingPermissionRequests').mockReturnValue([
      {
        requestId: 'request-ask-1',
        toolName: 'AskUserQuestion',
        toolUseId: 'tool-ask-1',
        input: { questions: [] },
        description: 'Answer questions?',
      },
    ])

    handleWebSocket.open(ws)

    expect(ws.sent.map((payload) => JSON.parse(payload))).toEqual([
      { type: 'connected', sessionId },
    ])
  })

  it('does not replay pending permission requests on SDK chat connections', () => {
    const sessionId = `sdk-chat-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId, 'sdk_chat')
    spyOn(conversationService, 'hasSession').mockReturnValue(true)
    spyOn(conversationService, 'onOutput').mockImplementation(() => {})
    spyOn(conversationService, 'removeOutputCallback').mockImplementation(() => {})
    spyOn(conversationService, 'getPendingPermissionRequests').mockReturnValue([
      {
        requestId: 'request-ask-1',
        toolName: 'AskUserQuestion',
        toolUseId: 'tool-ask-1',
        input: { questions: [] },
        description: 'Answer questions?',
      },
    ])

    handleWebSocket.open(ws)

    expect(ws.sent.map((payload) => JSON.parse(payload))).toEqual([
      { type: 'connected', sessionId },
    ])
  })

  it('reports an error when a permission response has no pending request', () => {
    const sessionId = `permission-missing-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId, 'interaction_response')
    spyOn(conversationService, 'respondToPermission').mockReturnValue(false)

    handleWebSocket.message(ws, JSON.stringify({
      type: 'permission_response',
      requestId: 'missing-request',
      allowed: true,
      updatedInput: {},
    }))

    expect(ws.sent.map((payload) => JSON.parse(payload))).toContainEqual({
      type: 'error',
      code: 'PERMISSION_RESPONSE_NOT_PENDING',
      message: `No pending permission request missing-request is active for session ${sessionId}`,
      retryable: false,
    })
  })

  it('rejects invalid runtime selections before persisting them', async () => {
    const sessionId = `runtime-invalid-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)

    handleWebSocket.message(ws, JSON.stringify({
      type: 'set_runtime_config',
      providerId: 'provider-a',
      modelId: '   ',
    }))
    handleWebSocket.message(ws, JSON.stringify({
      type: 'set_runtime_config',
      providerId: 'provider-a',
      modelId: 'model-a',
      effortLevel: 'too-much',
    }))
    handleWebSocket.message(ws, JSON.stringify({
      type: 'set_runtime_config',
      kind: 'local_cli',
      providerId: null,
      modelId: 'model-a',
    }))
    await waitForAsyncHandlers()

    expect(sentMessages(ws)).toEqual([
      {
        type: 'error',
        message: 'Runtime model selection is invalid.',
        code: 'RUNTIME_CONFIG_INVALID',
      },
      {
        type: 'error',
        message: 'Runtime effort selection is invalid.',
        code: 'RUNTIME_CONFIG_INVALID',
      },
      {
        type: 'error',
        message: 'Local CLI runtime selection is invalid.',
        code: 'RUNTIME_CONFIG_INVALID',
      },
    ])
  })

  it('rejects unavailable local CLI runtime selections', async () => {
    const sessionId = `runtime-unavailable-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    spyOn(localCliRuntimeService, 'listLocalClis').mockResolvedValue({
      activeId: null,
      clis: [
        {
          id: 'codex',
          displayName: 'Codex CLI',
          command: 'codex',
          executablePath: null,
          launchPath: null,
          launchKind: 'selected',
          source: null,
          available: false,
          supportsDesktopRuntime: true,
          version: null,
          config: {},
          configFields: [],
          models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
          modelRoles: {
            primary: 'gpt-5-codex',
            fast: 'gpt-5-codex',
            balanced: 'gpt-5-codex',
            powerful: 'gpt-5-codex',
          },
          enabledModels: ['gpt-5-codex'],
        },
      ],
    })

    handleWebSocket.message(ws, JSON.stringify({
      type: 'set_runtime_config',
      kind: 'local_cli',
      providerId: null,
      localCliId: 'codex',
      modelId: 'gpt-5-codex',
    }))
    await waitForAsyncHandlers()

    expect(sentMessages(ws)).toContainEqual({
      type: 'error',
      message: 'Selected local CLI is no longer available.',
      code: 'RUNTIME_CONFIG_INVALID',
    })
  })

  it('persists provider runtime selections without a default-provider concept', async () => {
    const sessionId = `runtime-provider-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const workDir = 'F:\\workspace'
    spyOn(conversationService, 'hasSession').mockReturnValue(false)
    spyOn(conversationService, 'getSessionWorkDir').mockReturnValue(null)
    spyOn(sessionService, 'getSessionWorkDir').mockResolvedValue(workDir)
    const appendMetadata = spyOn(sessionService, 'appendSessionMetadata').mockResolvedValue()

    handleWebSocket.message(ws, JSON.stringify({
      type: 'set_runtime_config',
      kind: 'provider',
      providerId: 'provider-a',
      modelId: 'provider-main',
      effortLevel: 'high',
    }))
    await waitForAsyncHandlers()

    expect(appendMetadata).toHaveBeenCalledWith(sessionId, {
      workDir,
      runtimeKind: 'provider',
      runtimeProviderId: 'provider-a',
      runtimeLocalCliId: null,
      runtimeModelId: 'provider-main',
      effortLevel: 'high',
    })
  })

  it('persists local CLI runtime selections and ignores duplicate selections', async () => {
    const sessionId = `runtime-local-cli-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const workDir = 'F:\\workspace'
    spyOn(localCliRuntimeService, 'listLocalClis').mockResolvedValue({
      activeId: 'codex',
      clis: [
        {
          id: 'codex',
          displayName: 'Codex CLI',
          command: 'codex',
          executablePath: 'codex.cmd',
          launchPath: 'codex.cmd',
          launchKind: 'selected',
          source: 'path',
          available: true,
          supportsDesktopRuntime: true,
          version: '1.0.0',
          config: {},
          configFields: [],
          models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
          modelRoles: {
            primary: 'gpt-5-codex',
            fast: 'gpt-5-codex',
            balanced: 'gpt-5-codex',
            powerful: 'gpt-5-codex',
          },
          enabledModels: ['gpt-5-codex'],
        },
      ],
    })
    spyOn(conversationService, 'hasSession').mockReturnValue(false)
    spyOn(conversationService, 'getSessionWorkDir').mockReturnValue(null)
    spyOn(sessionService, 'getSessionWorkDir').mockResolvedValue(workDir)
    const appendMetadata = spyOn(sessionService, 'appendSessionMetadata').mockResolvedValue()

    const message = {
      type: 'set_runtime_config',
      kind: 'local_cli',
      providerId: null,
      localCliId: 'codex',
      modelId: 'gpt-5-codex',
    }
    handleWebSocket.message(ws, JSON.stringify(message))
    await waitForAsyncHandlers()
    handleWebSocket.message(ws, JSON.stringify(message))
    await waitForAsyncHandlers()

    expect(appendMetadata).toHaveBeenCalledTimes(1)
    expect(appendMetadata).toHaveBeenCalledWith(sessionId, {
      workDir,
      runtimeKind: 'local_cli',
      runtimeProviderId: null,
      runtimeLocalCliId: 'codex',
      runtimeModelId: 'gpt-5-codex',
    })
  })

  it('starts user turns with the selected local CLI runtime settings', async () => {
    const sessionId = `runtime-local-start-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const workDir = 'F:\\workspace'
    spyOn(conversationService, 'hasSession').mockReturnValue(false)
    spyOn(conversationService, 'onOutput').mockImplementation(() => {})
    spyOn(conversationService, 'getRecentSdkMessages').mockReturnValue([])
    spyOn(sessionService, 'getSessionWorkDir').mockResolvedValue(workDir)
    spyOn(sessionService, 'getSessionLaunchInfo').mockResolvedValue(null)
    spyOn(sessionService, 'getCustomTitle').mockResolvedValue(null)
    spyOn(ProviderService.prototype, 'listProviders').mockResolvedValue({
      providers: [],
      activeId: null,
    })
    spyOn(SettingsService.prototype, 'getUserSettings').mockResolvedValue({
      executionMode: 'local_cli',
      alwaysThinkingEnabled: false,
      effort: 'medium',
    } as any)
    spyOn(SettingsService.prototype, 'getPermissionMode').mockResolvedValue('acceptEdits' as any)
    spyOn(localCliRuntimeService, 'listLocalClis').mockResolvedValue({
      activeId: 'codex',
      clis: [
        {
          id: 'codex',
          displayName: 'Codex CLI',
          command: 'codex',
          executablePath: 'codex.cmd',
          launchPath: 'codex.cmd',
          launchKind: 'selected',
          source: 'path',
          available: true,
          supportsDesktopRuntime: true,
          version: '1.0.0',
          config: {},
          configFields: [],
          models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
          modelRoles: {
            primary: 'gpt-5-codex',
            fast: 'gpt-5-codex',
            balanced: 'gpt-5-codex',
            powerful: 'gpt-5-codex',
          },
          enabledModels: ['gpt-5-codex'],
        },
      ],
    })
    const startSession = spyOn(conversationService, 'startSession').mockResolvedValue()
    spyOn(conversationService, 'sendMessage').mockResolvedValue(true)

    handleWebSocket.message(ws, JSON.stringify({
      type: 'user_message',
      content: '',
      metadata: { source: 'runtime-test' },
    }))
    await waitForCall(startSession)

    expect(startSession).toHaveBeenCalledWith(
      sessionId,
      workDir,
      expect.stringContaining(`/sdk/${sessionId}`),
      expect.objectContaining({
        permissionMode: 'acceptEdits',
        model: 'gpt-5-codex',
        effort: 'medium',
        thinking: 'disabled',
        providerId: null,
        localCliId: 'codex',
        executionMode: 'local_cli',
        metadata: { source: 'runtime-test' },
      }),
    )
  })

  it('starts user turns with a persisted local CLI runtime selection', async () => {
    const sessionId = `runtime-start-local-cli-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    spyOn(sessionService, 'getSessionLaunchInfo').mockResolvedValue({
      permissionMode: 'dontAsk',
      runtimeKind: 'local_cli',
      runtimeProviderId: null,
      runtimeLocalCliId: 'codex',
      runtimeModelId: 'gpt-5-codex',
    } as any)
    spyOn(sessionService, 'getSessionWorkDir').mockResolvedValue('F:\\workspace')
    spyOn(sessionService, 'getCustomTitle').mockResolvedValue(null as any)
    spyOn(localCliRuntimeService, 'listLocalClis').mockResolvedValue({
      activeId: 'codex',
      clis: [makeAvailableLocalCli()],
    })
    spyOn(conversationService, 'hasSession').mockReturnValue(false)
    const startSession = spyOn(conversationService, 'startSession').mockResolvedValue(undefined as any)
    spyOn(conversationService, 'sendMessage').mockResolvedValue(true)

    handleWebSocket.message(ws, JSON.stringify({
      type: 'user_message',
      content: '',
    }))
    await waitForCall(startSession)

    expect(startSession).toHaveBeenCalled()
    expect(startSession.mock.calls[0]?.[3]).toEqual(expect.objectContaining({
      permissionMode: 'dontAsk',
      model: 'gpt-5-codex',
      providerId: null,
      localCliId: 'codex',
      executionMode: 'local_cli',
    }))
  })

  it('falls back to default runtime when a persisted local CLI is stale', async () => {
    const originalConfigDir = process.env.BEYA_CONFIG_DIR
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beya-ws-runtime-'))
    process.env.BEYA_CONFIG_DIR = tmpDir
    try {
      const sessionId = `runtime-start-stale-cli-${crypto.randomUUID()}`
      const ws = makeClientSocket(sessionId)
      spyOn(sessionService, 'getSessionLaunchInfo').mockResolvedValue({
        permissionMode: 'default',
        runtimeKind: 'local_cli',
        runtimeProviderId: null,
        runtimeLocalCliId: 'codex',
        runtimeModelId: 'gpt-5-codex',
      } as any)
      spyOn(sessionService, 'getSessionWorkDir').mockResolvedValue('F:\\workspace')
      spyOn(sessionService, 'getCustomTitle').mockResolvedValue(null as any)
      spyOn(localCliRuntimeService, 'listLocalClis').mockResolvedValue({
        activeId: null,
        clis: [],
      })
      spyOn(conversationService, 'hasSession').mockReturnValue(false)
      const startSession = spyOn(conversationService, 'startSession').mockResolvedValue(undefined as any)
      spyOn(conversationService, 'sendMessage').mockResolvedValue(true)

      handleWebSocket.message(ws, JSON.stringify({
        type: 'user_message',
        content: '',
      }))
      await waitForCall(startSession)

      expect(startSession.mock.calls[0]?.[3]).toEqual(expect.objectContaining({
        permissionMode: 'default',
        providerId: null,
        localCliId: null,
        executionMode: 'provider',
      }))
    } finally {
      if (originalConfigDir === undefined) delete process.env.BEYA_CONFIG_DIR
      else process.env.BEYA_CONFIG_DIR = originalConfigDir
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('uses the active available local CLI as the default runtime in local_cli mode', async () => {
    const originalConfigDir = process.env.BEYA_CONFIG_DIR
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beya-ws-default-runtime-'))
    process.env.BEYA_CONFIG_DIR = tmpDir
    try {
      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({ executionMode: 'local_cli', defaultMode: 'acceptEdits' }),
        'utf-8',
      )
      const sessionId = `runtime-default-local-cli-${crypto.randomUUID()}`
      const ws = makeClientSocket(sessionId)
      spyOn(sessionService, 'getSessionLaunchInfo').mockResolvedValue(null as any)
      spyOn(sessionService, 'getSessionWorkDir').mockResolvedValue('F:\\workspace')
      spyOn(sessionService, 'getCustomTitle').mockResolvedValue(null as any)
      spyOn(localCliRuntimeService, 'listLocalClis').mockResolvedValue({
        activeId: 'codex',
        clis: [makeAvailableLocalCli()],
      })
      spyOn(conversationService, 'hasSession').mockReturnValue(false)
      const startSession = spyOn(conversationService, 'startSession').mockResolvedValue(undefined as any)
      spyOn(conversationService, 'sendMessage').mockResolvedValue(true)

      handleWebSocket.message(ws, JSON.stringify({
        type: 'user_message',
        content: '',
      }))
      await waitForCall(startSession)

      expect(startSession.mock.calls[0]?.[3]).toEqual(expect.objectContaining({
        permissionMode: 'acceptEdits',
        model: 'gpt-5-codex',
        providerId: null,
        localCliId: 'codex',
        executionMode: 'local_cli',
      }))
    } finally {
      if (originalConfigDir === undefined) delete process.env.BEYA_CONFIG_DIR
      else process.env.BEYA_CONFIG_DIR = originalConfigDir
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('keeps disconnected sessions alive longer while user input is pending', () => {
    const sessionId = `permission-disconnect-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any)
    spyOn(conversationService, 'getPendingPermissionRequests').mockReturnValue([
      {
        requestId: 'request-ask-1',
        toolName: 'AskUserQuestion',
        toolUseId: 'tool-ask-1',
        input: { questions: [] },
      },
    ])

    handleWebSocket.open(ws)
    setTimeoutSpy.mockClear()

    handleWebSocket.close(ws, 1006, 'renderer reconnecting')

    expect(setTimeoutSpy).toHaveBeenCalled()
    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBeGreaterThan(30_000)
  })

  it('does not stop runtimes when an SDK chat websocket disconnects', () => {
    const sessionId = `sdk-chat-disconnect-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId, 'sdk_chat')
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any)
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    const cancelComputerUse = spyOn(computerUseApprovalService, 'cancelSession').mockImplementation(() => {})

    handleWebSocket.open(ws)
    setTimeoutSpy.mockClear()

    handleWebSocket.close(ws, 1000, 'sdk stream completed')

    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(stopSession).not.toHaveBeenCalled()
    expect(cancelComputerUse).not.toHaveBeenCalled()
  })

  it('does not stop runtimes when an SDK interaction response websocket disconnects', () => {
    const sessionId = `sdk-response-disconnect-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId, 'interaction_response')
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any)
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    const cancelComputerUse = spyOn(computerUseApprovalService, 'cancelSession').mockImplementation(() => {})

    handleWebSocket.open(ws)
    setTimeoutSpy.mockClear()

    handleWebSocket.close(ws, 1000, 'interaction response completed')

    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(stopSession).not.toHaveBeenCalled()
    expect(cancelComputerUse).not.toHaveBeenCalled()
  })
})
