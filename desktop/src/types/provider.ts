// desktop/src/types/provider.ts

export type ApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'

export type ProviderAuthStrategy =
  | 'api_key'
  | 'auth_token'
  | 'auth_token_empty_api_key'
  | 'dual_same_token'
  | 'dual_dummy'

export type ProviderRuntimeKind = 'anthropic_compatible' | 'openai_oauth'

export type ModelRoles = {
  primary: string
  fast: string
  balanced: string
  powerful: string
}

export type ModelContextWindows = Record<string, number>

export type ConnectionOverrides = {
  baseUrl?: string
  apiFormat?: ApiFormat
  authStrategy?: ProviderAuthStrategy
  runtimeKind?: ProviderRuntimeKind
  defaultEnv?: Record<string, string>
}

export type SavedProvider = {
  providerId: string
  displayName: string
  apiKey: string  // masked from server
  authStrategy?: ProviderAuthStrategy
  baseUrl: string
  apiFormat: ApiFormat
  runtimeKind?: ProviderRuntimeKind
  modelRoles: ModelRoles
  enabledModels: string[]
  connectionOverrides?: ConnectionOverrides
  autoCompactWindow?: number
  modelContextWindows?: ModelContextWindows
  notes?: string
}

export type CreateProviderInput = {
  providerId: string
  displayName: string
  apiKey: string
  authStrategy?: ProviderAuthStrategy
  baseUrl: string
  apiFormat?: ApiFormat
  runtimeKind?: ProviderRuntimeKind
  modelRoles: ModelRoles
  enabledModels?: string[]
  connectionOverrides?: ConnectionOverrides
  autoCompactWindow?: number
  modelContextWindows?: ModelContextWindows
  notes?: string
}

export type UpdateProviderInput = {
  displayName?: string
  apiKey?: string
  authStrategy?: ProviderAuthStrategy
  baseUrl?: string
  apiFormat?: ApiFormat
  runtimeKind?: ProviderRuntimeKind
  modelRoles?: ModelRoles
  enabledModels?: string[]
  connectionOverrides?: ConnectionOverrides
  autoCompactWindow?: number | null
  modelContextWindows?: ModelContextWindows | null
  notes?: string
}

export type TestProviderConfigInput = {
  baseUrl: string
  apiKey: string
  modelId: string
  authStrategy?: ProviderAuthStrategy
  apiFormat?: ApiFormat
}

export type ProviderTestStepResult = {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  httpStatus?: number
}

export type ProviderTestResult = {
  /** Step 1: Basic connectivity */
  connectivity: ProviderTestStepResult
  /** Step 2: Proxy pipeline (only for openai_* formats) */
  proxy?: ProviderTestStepResult
}
