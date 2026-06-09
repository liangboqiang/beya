import { create } from 'zustand'
import type { RuntimeProfile, RuntimeSelection } from '../types/runtime'

const STORAGE_KEY = 'beya-session-runtime'

export const DRAFT_RUNTIME_SELECTION_KEY = '__draft__'

type SessionRuntimeStore = {
  selections: Record<string, RuntimeSelection>
  resolvedProfiles: Record<string, RuntimeProfile>
  setSelection: (key: string, selection: RuntimeSelection) => void
  setResolvedProfile: (key: string, profile: RuntimeProfile | null) => void
  clearSelection: (key: string) => void
  moveSelection: (fromKey: string, toKey: string) => void
}

function loadSelections(): Record<string, RuntimeSelection> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, RuntimeSelection>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function persistSelections(selections: Record<string, RuntimeSelection>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch {
    // noop
  }
}

export const useSessionRuntimeStore = create<SessionRuntimeStore>((set) => ({
  selections: loadSelections(),
  resolvedProfiles: {},

  setSelection: (key, selection) =>
    set((state) => {
      const selections = {
        ...state.selections,
        [key]: selection,
      }
      persistSelections(selections)
      return { selections }
    }),

  setResolvedProfile: (key, profile) =>
    set((state) => {
      if (!profile) {
        if (!(key in state.resolvedProfiles)) return state
        const { [key]: _removed, ...rest } = state.resolvedProfiles
        return { resolvedProfiles: rest }
      }
      return {
        resolvedProfiles: {
          ...state.resolvedProfiles,
          [key]: profile,
        },
      }
    }),

  clearSelection: (key) =>
    set((state) => {
      if (!(key in state.selections)) return state
      const { [key]: _removed, ...rest } = state.selections
      persistSelections(rest)
      const { [key]: _removedProfile, ...resolvedProfiles } = state.resolvedProfiles
      return { selections: rest, resolvedProfiles }
    }),

  moveSelection: (fromKey, toKey) =>
    set((state) => {
      const selection = state.selections[fromKey]
      if (!selection) return state
      const { [fromKey]: _removed, ...rest } = state.selections
      const selections = {
        ...rest,
        [toKey]: selection,
      }
      const profile = state.resolvedProfiles[fromKey]
      const { [fromKey]: _removedProfile, ...profileRest } = state.resolvedProfiles
      persistSelections(selections)
      return {
        selections,
        resolvedProfiles: profile
          ? { ...profileRest, [toKey]: profile }
          : profileRest,
      }
    }),
}))
