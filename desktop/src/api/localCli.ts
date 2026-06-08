import { api } from './client'
import type { LocalCliRuntimeList, LocalCliTestResult, UpdateLocalCliRuntimeInput } from '../types/localCli'

export const localCliApi = {
  list() {
    return api.get<LocalCliRuntimeList>('/api/local-cli')
  },

  rescan() {
    return api.post<LocalCliRuntimeList>('/api/local-cli/rescan')
  },

  activate(id: string | null) {
    return api.put<LocalCliRuntimeList>('/api/local-cli/active', { id })
  },

  updateConfig(id: string, config: Record<string, unknown> | UpdateLocalCliRuntimeInput) {
    return api.put<LocalCliRuntimeList>('/api/local-cli/config', { id, config })
  },

  test(id: string) {
    return api.post<{ result: LocalCliTestResult }>('/api/local-cli/test', { id })
  },
}
