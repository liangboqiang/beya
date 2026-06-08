// desktop/src/api/providers.ts

import { api } from './client'
import type {
  SavedProvider,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderConfigInput,
  ProviderTestResult,
} from '../types/provider'
import type { ProviderCatalog } from '../types/providerCatalog'

type ProvidersResponse = { providers: SavedProvider[]; activeId: string | null }
type ProviderResponse = { provider: SavedProvider }
type CatalogResponse = { catalog: ProviderCatalog }
type TestResultResponse = { result: ProviderTestResult }
type AuthStatusResponse = {
  hasAuth: boolean
  source: 'beya-provider' | 'env' | 'none'
  activeProvider?: string
}

export const providersApi = {
  list() {
    return api.get<ProvidersResponse>('/api/providers')
  },

  catalog() {
    return api.get<CatalogResponse>('/api/providers/catalog')
  },

  authStatus() {
    return api.get<AuthStatusResponse>('/api/providers/auth-status')
  },

  getSettings() {
    return api.get<Record<string, unknown>>('/api/providers/settings')
  },

  updateSettings(settings: Record<string, unknown>) {
    return api.put<{ ok: true }>('/api/providers/settings', settings)
  },

  create(input: CreateProviderInput) {
    return api.post<ProviderResponse>('/api/providers', input)
  },

  rescan() {
    return api.post<ProvidersResponse>('/api/providers/rescan')
  },

  update(id: string, input: UpdateProviderInput) {
    return api.patch<ProviderResponse>(`/api/providers/${id}`, input)
  },

  delete(id: string) {
    return api.delete<{ ok: true }>(`/api/providers/${id}`)
  },

  activate(id: string) {
    return api.post<{ ok: true }>(`/api/providers/${id}/activate`)
  },

  test(id: string, overrides?: { baseUrl?: string; modelId?: string; apiFormat?: string; authStrategy?: string }) {
    return api.post<TestResultResponse>(`/api/providers/${id}/test`, overrides)
  },

  testConfig(input: TestProviderConfigInput) {
    return api.post<TestResultResponse>('/api/providers/test', input)
  },
}
