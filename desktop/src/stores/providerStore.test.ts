import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedProvider } from '../types/provider'

const {
  providersApiMock,
  chatStoreState,
  runtimeStoreState,
  setSessionRuntimeMock,
  setSelectionMock,
  settingsSetModelMock,
  settingsFetchAllMock,
} = vi.hoisted(() => ({
  providersApiMock: {
    list: vi.fn(),
    presets: vi.fn(),
    authStatus: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    activate: vi.fn(),
    test: vi.fn(),
    testConfig: vi.fn(),
  },
  chatStoreState: {
    sessions: {} as Record<string, { connectionState: string; chatState: string }>,
    setSessionRuntime: vi.fn(),
  },
  runtimeStoreState: {
    selections: {} as Record<string, { providerId: string | null; modelId: string }>,
    setSelection: vi.fn(),
  },
  setSessionRuntimeMock: vi.fn(),
  setSelectionMock: vi.fn(),
  settingsSetModelMock: vi.fn(),
  settingsFetchAllMock: vi.fn(),
}))

vi.mock('../api/providers', () => ({
  providersApi: providersApiMock,
}))

vi.mock('./chatStore', () => ({
  useChatStore: {
    getState: () => ({
      ...chatStoreState,
      setSessionRuntime: setSessionRuntimeMock,
    }),
  },
}))

vi.mock('./sessionRuntimeStore', () => ({
  useSessionRuntimeStore: {
    getState: () => ({
      ...runtimeStoreState,
      setSelection: setSelectionMock,
    }),
  },
}))

vi.mock('./settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      setModel: settingsSetModelMock,
      fetchAll: settingsFetchAllMock,
    }),
  },
}))

function makeProvider(overrides: Partial<SavedProvider> = {}): SavedProvider {
  return {
    providerId: 'provider-a',
    displayName: 'Provider A',
    apiKey: 'key-a',
    baseUrl: 'https://example.invalid/api',
    apiFormat: 'anthropic',
    modelRoles: {
      primary: 'model-primary',
      fast: 'model-fast',
      balanced: 'model-balanced',
      powerful: 'model-powerful',
    },
    enabledModels: ['model-primary', 'model-fast', 'model-balanced', 'model-powerful'],
    ...overrides,
  }
}

describe('providerStore runtime refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatStoreState.sessions = {}
    runtimeStoreState.selections = {}
    providersApiMock.list.mockResolvedValue({ providers: [], activeId: null })
  })

  it('reapplies an updated active provider to idle connected sessions using default runtime', async () => {
    const provider = makeProvider()
    providersApiMock.update.mockResolvedValue({ provider })
    providersApiMock.list.mockResolvedValue({ providers: [provider], activeId: provider.providerId })
    chatStoreState.sessions = {
      'session-a': { connectionState: 'connected', chatState: 'idle' },
    }

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().updateProvider(provider.providerId, { apiKey: 'new-key' })

    expect(setSelectionMock).toHaveBeenCalledWith('session-a', {
      providerId: provider.providerId,
      modelId: 'model-primary',
    })
    expect(setSessionRuntimeMock).toHaveBeenCalledWith('session-a', {
      providerId: provider.providerId,
      modelId: 'model-primary',
    })
  })

  it('keeps an explicit provider model selection when the model still exists', async () => {
    const provider = makeProvider()
    providersApiMock.update.mockResolvedValue({ provider })
    providersApiMock.list.mockResolvedValue({ providers: [provider], activeId: null })
    chatStoreState.sessions = {
      'session-a': { connectionState: 'connected', chatState: 'idle' },
    }
    runtimeStoreState.selections = {
      'session-a': { providerId: provider.providerId, modelId: 'model-powerful' },
    }

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().updateProvider(provider.providerId, { apiKey: 'new-key' })

    expect(setSessionRuntimeMock).toHaveBeenCalledWith('session-a', {
      providerId: provider.providerId,
      modelId: 'model-powerful',
    })
  })

  it('does not restart busy sessions while a provider update is saved', async () => {
    const provider = makeProvider()
    providersApiMock.update.mockResolvedValue({ provider })
    providersApiMock.list.mockResolvedValue({ providers: [provider], activeId: provider.providerId })
    chatStoreState.sessions = {
      'session-a': { connectionState: 'connected', chatState: 'streaming' },
      'session-b': { connectionState: 'disconnected', chatState: 'idle' },
    }

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().updateProvider(provider.providerId, { apiKey: 'new-key' })

    expect(setSelectionMock).not.toHaveBeenCalled()
    expect(setSessionRuntimeMock).not.toHaveBeenCalled()
  })

  it('sets the OpenAI default model when activating built-in ChatGPT Official', async () => {
    providersApiMock.activate.mockResolvedValue({ ok: true })
    providersApiMock.list.mockResolvedValue({
      providers: [],
      activeId: 'openai-official',
    })

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().activateProvider('openai-official')

    expect(settingsSetModelMock).toHaveBeenCalledWith('gpt-5.3-codex')
    expect(settingsFetchAllMock).toHaveBeenCalled()
  })

  it('sets the provider primary model when activating a saved provider', async () => {
    const provider = makeProvider()
    providersApiMock.activate.mockResolvedValue({ ok: true })
    providersApiMock.list.mockResolvedValue({
      providers: [provider],
      activeId: provider.providerId,
    })

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().activateProvider(provider.providerId)

    expect(settingsSetModelMock).toHaveBeenCalledWith('model-primary')
    expect(settingsFetchAllMock).toHaveBeenCalled()
  })
})
