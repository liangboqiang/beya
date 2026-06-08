import { beforeEach, describe, expect, it, vi } from 'vitest'

const localCliApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  rescan: vi.fn(),
  activate: vi.fn(),
  updateConfig: vi.fn(),
  test: vi.fn(),
}))

vi.mock('../api/localCli', () => ({
  localCliApi: localCliApiMock,
}))

describe('localCliStore', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { useLocalCliStore } = await import('./localCliStore')
    useLocalCliStore.setState(useLocalCliStore.getInitialState(), true)
  })

  it('loads detected local CLIs', async () => {
    localCliApiMock.list.mockResolvedValue({
      activeId: null,
      clis: [
        {
          id: 'codex',
          displayName: 'Codex CLI',
          command: 'codex',
          executablePath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
          launchPath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
          launchKind: 'selected',
          source: 'path',
          available: true,
          supportsDesktopRuntime: true,
          version: 'codex 1.0.0',
          config: {},
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

    const { useLocalCliStore } = await import('./localCliStore')
    await useLocalCliStore.getState().fetchClis()

    expect(useLocalCliStore.getState()).toMatchObject({
      activeId: null,
      isLoading: false,
      error: null,
    })
    expect(useLocalCliStore.getState().clis).toHaveLength(1)
  })

  it('persists selected CLI from the API response', async () => {
    localCliApiMock.activate.mockResolvedValue({
      activeId: 'codex',
      clis: [
        {
          id: 'codex',
          displayName: 'Codex CLI',
          command: 'codex',
          executablePath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
          launchPath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
          launchKind: 'selected',
          source: 'path',
          available: true,
          supportsDesktopRuntime: true,
          version: 'codex 1.0.0',
          config: {},
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

    const { useLocalCliStore } = await import('./localCliStore')
    await useLocalCliStore.getState().activateCli('codex')

    expect(localCliApiMock.activate).toHaveBeenCalledWith('codex')
    expect(useLocalCliStore.getState()).toMatchObject({
      activeId: 'codex',
      isSaving: false,
      error: null,
    })
  })

  it('persists CLI config from the API response', async () => {
    localCliApiMock.updateConfig.mockResolvedValue({
      activeId: 'codex',
      clis: [
        {
          id: 'codex',
          displayName: 'Codex CLI',
          command: 'codex',
          executablePath: 'C:\\Tools\\codex.cmd',
          launchPath: 'C:\\Tools\\codex.cmd',
          launchKind: 'selected',
          source: 'configured',
          available: true,
          supportsDesktopRuntime: true,
          version: null,
          config: { CODEX_BIN: 'C:\\Tools\\codex.cmd' },
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

    const { useLocalCliStore } = await import('./localCliStore')
    await useLocalCliStore.getState().updateCliConfig('codex', { CODEX_BIN: 'C:\\Tools\\codex.cmd' })

    expect(localCliApiMock.updateConfig).toHaveBeenCalledWith('codex', { CODEX_BIN: 'C:\\Tools\\codex.cmd' })
    expect(useLocalCliStore.getState().clis[0]?.config).toEqual({ CODEX_BIN: 'C:\\Tools\\codex.cmd' })
  })

  it('tests a CLI through the provider-like config API', async () => {
    localCliApiMock.test.mockResolvedValue({
      result: {
        success: true,
        latencyMs: 24,
        version: 'codex 1.0.0',
        executablePath: 'C:\\Tools\\codex.cmd',
        launchPath: 'C:\\Tools\\codex.cmd',
      },
    })

    const { useLocalCliStore } = await import('./localCliStore')
    const result = await useLocalCliStore.getState().testCli('codex')

    expect(localCliApiMock.test).toHaveBeenCalledWith('codex')
    expect(result).toMatchObject({
      success: true,
      version: 'codex 1.0.0',
    })
  })
})
