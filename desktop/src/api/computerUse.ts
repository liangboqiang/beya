import { api } from './client'

export type ComputerUseStatus = {
  platform: string
  supported: boolean
  python: {
    installed: boolean
    version: string | null
    path: string | null
    source: 'custom' | 'system' | 'venv' | null
    error: string | null
  }
  venv: {
    created: boolean
    path: string
  }
  dependencies: {
    installed: boolean
    requirementsFound: boolean
  }
  permissions: {
    accessibility: boolean | null
    screenRecording: boolean | null
  }
}

export type SetupStep = {
  name: string
  ok: boolean
  message: string
}

export type SetupResult = {
  success: boolean
  steps: SetupStep[]
}

export type InstalledApp = {
  bundleId: string
  displayName: string
  path: string
}

export type AuthorizedApp = {
  bundleId: string
  displayName: string
  authorizedAt: string
}

export type ComputerUseConfig = {
  enabled: boolean
  authorizedApps: AuthorizedApp[]
  grantFlags: {
    clipboardRead: boolean
    clipboardWrite: boolean
    systemKeyCombos: boolean
  }
  pythonPath: string | null
}

export const computerUseApi = {
  getStatus() {
    return api.get<ComputerUseStatus>('/computer-use/status')
  },
  runSetup() {
    return api.post<SetupResult>('/computer-use/setup', undefined, { timeout: 300_000 })
  },
  getInstalledApps() {
    return api.get<{ apps: InstalledApp[] }>('/computer-use/apps')
  },
  getAuthorizedApps() {
    return api.get<ComputerUseConfig>('/computer-use/authorized-apps')
  },
  setAuthorizedApps(config: Partial<ComputerUseConfig>) {
    return api.put<{ ok: true }>('/computer-use/authorized-apps', config)
  },
  openSettings(pane: 'Privacy_ScreenCapture' | 'Privacy_Accessibility') {
    return api.post<{ ok: true }>('/computer-use/open-settings', { pane })
  },
}
