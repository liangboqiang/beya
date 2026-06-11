import { api } from './client'
import type { LocalCliRuntimeList, LocalCliTestResult, UpdateLocalCliRuntimeInput } from '../types/localCli'

export const localCliApi = {
  list() {
    return api.get<LocalCliRuntimeList>('/local-cli')
  },

  rescan() {
    return api.post<LocalCliRuntimeList>('/local-cli/rescan')
  },

  activate(id: string | null) {
    return api.put<LocalCliRuntimeList>('/local-cli/active', { id })
  },

  updateConfig(id: string, config: Record<string, unknown> | UpdateLocalCliRuntimeInput) {
    return api.put<LocalCliRuntimeList>('/local-cli/config', { id, config })
  },

  test(id: string) {
    return api.post<{ result: LocalCliTestResult }>('/local-cli/test', { id })
  },
}
