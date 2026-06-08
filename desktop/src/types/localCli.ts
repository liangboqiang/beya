export type LocalCliSource =
  | 'configured'
  | 'env'
  | 'path'
  | 'toolchain'

export type LocalCliModelRoles = {
  primary: string
  fast: string
  balanced: string
  powerful: string
}

export type LocalCliModelContextWindows = Record<string, number>

export type LocalCliModelOption = {
  id: string
  label: string
}

export type UpdateLocalCliRuntimeInput = {
  config?: Record<string, unknown>
  modelRoles?: Partial<LocalCliModelRoles> | null
  autoCompactWindow?: number | null
  modelContextWindows?: LocalCliModelContextWindows | null
}

export type LocalCliRuntimeInfo = {
  id: string
  displayName: string
  command: string
  executablePath: string | null
  launchPath: string | null
  launchKind: 'selected' | 'codex-native'
  source: LocalCliSource | null
  available: boolean
  supportsDesktopRuntime: boolean
  version: string | null
  config: Record<string, string>
  models: LocalCliModelOption[]
  modelRoles: LocalCliModelRoles
  enabledModels: string[]
  autoCompactWindow?: number
  modelContextWindows?: LocalCliModelContextWindows
  installUrl?: string
  docsUrl?: string
  diagnostic?: string | null
}

export type LocalCliRuntimeList = {
  activeId: string | null
  clis: LocalCliRuntimeInfo[]
}

export type LocalCliTestResult = {
  success: boolean
  latencyMs: number
  version: string | null
  executablePath: string | null
  launchPath: string | null
  error?: string
}
