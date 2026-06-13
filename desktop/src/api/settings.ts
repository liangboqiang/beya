import { api } from './client'
import type { PermissionMode, UserSettings } from '../types/settings'

export type CliLauncherStatus = {
  supported: boolean
  command: string
  installed: boolean
  launcherPath: string
  binDir: string
  pathConfigured: boolean
  pathInCurrentShell: boolean
  availableInNewTerminals: boolean
  needsTerminalRestart: boolean
  configTarget: string | null
  lastError: string | null
}

export const settingsApi = {
  getUser() {
    return api.get<UserSettings>('/settings/user')
  },

  updateUser(settings: Partial<UserSettings>) {
    return api.put<{ ok: true }>('/settings/user', settings)
  },

  getPermissionMode() {
    return api.get<{ mode: PermissionMode }>('/permissions/mode')
  },

  setPermissionMode(mode: PermissionMode) {
    return api.put<{ ok: true; mode: PermissionMode }>('/permissions/mode', { mode })
  },

  getCliLauncherStatus() {
    return api.get<CliLauncherStatus>('/settings/cli-launcher')
  },
}
