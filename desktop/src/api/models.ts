import { api } from './client'
import type { ModelInfo, EffortLevel } from '../types/settings'

type ModelsResponse = { models: ModelInfo[]; provider: { id: string; name: string } | null }
type CurrentModelResponse = { model: ModelInfo }
type EffortResponse = { level: EffortLevel; available: EffortLevel[] }

export const modelsApi = {
  list() {
    return api.get<ModelsResponse>('/models')
  },

  getCurrent() {
    return api.get<CurrentModelResponse>('/models/current')
  },

  setCurrent(modelId: string) {
    return api.put<{ ok: true; model: string }>('/models/current', { modelId })
  },

  getEffort() {
    return api.get<EffortResponse>('/effort')
  },

  setEffort(level: EffortLevel) {
    return api.put<{ ok: true; level: EffortLevel }>('/effort', { level })
  },
}
