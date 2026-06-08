// desktop/src/stores/providerStore.ts

import { create } from 'zustand'
import { providersApi } from '../api/providers'
import { useChatStore } from './chatStore'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import { useSettingsStore } from './settingsStore'
import { getProviderModelRoles } from '../lib/modelRoles'
import type {
  SavedProvider,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderConfigInput,
  ProviderTestResult,
} from '../types/provider'
import type { ProviderCatalog } from '../types/providerCatalog'
import type { RuntimeSelection } from '../types/runtime'

type ProviderStore = {
  providers: SavedProvider[]
  activeId: string | null
  hasLoadedProviders: boolean
  catalog: ProviderCatalog | null
  isLoading: boolean
  isCatalogLoading: boolean
  error: string | null

  fetchProviders: () => Promise<void>
  fetchCatalog: () => Promise<void>
  createProvider: (input: CreateProviderInput) => Promise<SavedProvider>
  rescanProviders: () => Promise<void>
  updateProvider: (id: string, input: UpdateProviderInput) => Promise<SavedProvider>
  deleteProvider: (id: string) => Promise<void>
  activateProvider: (id: string) => Promise<void>
  testProvider: (id: string, overrides?: { baseUrl?: string; modelId?: string; apiFormat?: string; authStrategy?: string }) => Promise<ProviderTestResult>
  testConfig: (input: TestProviderConfigInput) => Promise<ProviderTestResult>
}

function providerModelIds(provider: SavedProvider): Set<string> {
  const modelRoles = getProviderModelRoles(provider)
  return new Set(
    Object.values(modelRoles)
      .map((modelId) => modelId.trim())
      .filter(Boolean),
  )
}

function resolveRuntimeRefreshSelection(
  provider: SavedProvider,
  activeId: string | null,
  currentSelection: RuntimeSelection | undefined,
): RuntimeSelection | null {
  if (currentSelection?.providerId === provider.providerId) {
    const modelIds = providerModelIds(provider)
    const modelRoles = getProviderModelRoles(provider)
    return {
      kind: 'provider',
      providerId: provider.providerId,
      localCliId: null,
      modelId: modelIds.has(currentSelection.modelId)
        ? currentSelection.modelId
        : modelRoles.primary,
      ...(currentSelection.effortLevel ? { effortLevel: currentSelection.effortLevel } : {}),
    }
  }

  if (!currentSelection && activeId === provider.providerId) {
    const modelRoles = getProviderModelRoles(provider)
    return {
      kind: 'provider',
      providerId: provider.providerId,
      localCliId: null,
      modelId: modelRoles.primary,
    }
  }

  return null
}

function refreshConnectedSessionsForProvider(provider: SavedProvider, activeId: string | null) {
  const chatStore = useChatStore.getState()
  const runtimeStore = useSessionRuntimeStore.getState()

  for (const [sessionId, session] of Object.entries(chatStore.sessions)) {
    if (session.connectionState !== 'connected' || session.chatState !== 'idle') {
      continue
    }

    const selection = resolveRuntimeRefreshSelection(
      provider,
      activeId,
      runtimeStore.selections[sessionId],
    )
    if (!selection) continue

    runtimeStore.setSelection(sessionId, selection)
    chatStore.setSessionRuntime(sessionId, selection)
  }
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: [],
  activeId: null,
  hasLoadedProviders: false,
  catalog: null,
  isLoading: false,
  isCatalogLoading: false,
  error: null,

  fetchProviders: async () => {
    set({ isLoading: true, error: null })
    try {
      const { providers, activeId } = await providersApi.list()
      set({ providers, activeId, hasLoadedProviders: true, isLoading: false })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  fetchCatalog: async () => {
    set({ isCatalogLoading: true, error: null })
    try {
      const { catalog } = await providersApi.catalog()
      set({ catalog, isCatalogLoading: false })
    } catch (err) {
      set({ isCatalogLoading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  createProvider: async (input) => {
    const { provider } = await providersApi.create(input)
    await get().fetchProviders()
    return provider
  },

  rescanProviders: async () => {
    set({ isLoading: true, error: null })
    try {
      const { providers, activeId } = await providersApi.rescan()
      set({ providers, activeId, hasLoadedProviders: true, isLoading: false })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  updateProvider: async (id, input) => {
    const { provider } = await providersApi.update(id, input)
    await get().fetchProviders()
    refreshConnectedSessionsForProvider(provider, get().activeId)
    return provider
  },

  deleteProvider: async (id) => {
    await providersApi.delete(id)
    await get().fetchProviders()
  },

  activateProvider: async (id) => {
    await providersApi.activate(id)
    await get().fetchProviders()
    // 更新默认 provider 时，同步刷新默认 model，避免 settings.json 里残留
    // 旧 provider 的 model id 导致默认选择指向不存在的模型。
    const settings = useSettingsStore.getState()
    const provider = get().providers.find((p) => p.providerId === id)
    if (!provider) return
    await settings.setExecutionMode('provider')
    await settings.setModel(getProviderModelRoles(provider).primary)
    await settings.fetchAll()
  },

  testProvider: async (id, overrides?) => {
    const { result } = await providersApi.test(id, overrides)
    if (result.availableModels?.length) {
      await get().fetchProviders()
    }
    return result
  },

  testConfig: async (input) => {
    const { result } = await providersApi.testConfig(input)
    return result
  },
}))
