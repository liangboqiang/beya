import { create } from 'zustand'
import { localCliApi } from '../api/localCli'
import type { LocalCliRuntimeInfo, LocalCliTestResult, UpdateLocalCliRuntimeInput } from '../types/localCli'

type LocalCliStore = {
  clis: LocalCliRuntimeInfo[]
  activeId: string | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  fetchClis: () => Promise<void>
  rescanClis: () => Promise<void>
  activateCli: (id: string | null) => Promise<void>
  updateCliConfig: (id: string, config: Record<string, unknown> | UpdateLocalCliRuntimeInput) => Promise<void>
  testCli: (id: string) => Promise<LocalCliTestResult>
}

export const useLocalCliStore = create<LocalCliStore>((set) => ({
  clis: [],
  activeId: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchClis: async () => {
    set({ isLoading: true, error: null })
    try {
      const result = await localCliApi.list()
      set({
        clis: result.clis,
        activeId: result.activeId,
        isLoading: false,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  rescanClis: async () => {
    set({ isLoading: true, error: null })
    try {
      const result = await localCliApi.rescan()
      set({
        clis: result.clis,
        activeId: result.activeId,
        isLoading: false,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  activateCli: async (id) => {
    set({ isSaving: true, error: null })
    try {
      const result = await localCliApi.activate(id)
      set({
        clis: result.clis,
        activeId: result.activeId,
        isSaving: false,
      })
    } catch (err) {
      set({
        isSaving: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  updateCliConfig: async (id, config) => {
    set({ isSaving: true, error: null })
    try {
      const result = await localCliApi.updateConfig(id, config)
      set({
        clis: result.clis,
        activeId: result.activeId,
        isSaving: false,
      })
    } catch (err) {
      set({
        isSaving: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  testCli: async (id) => {
    set({ error: null })
    try {
      const result = await localCliApi.test(id)
      return result.result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      return {
        success: false,
        latencyMs: 0,
        version: null,
        executablePath: null,
        launchPath: null,
        error: message,
      }
    }
  },
}))
