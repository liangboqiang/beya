import type { ApiFormat, ModelRoles, ProviderAuthStrategy } from './provider'

export type ModelTier = 'small' | 'medium' | 'large'

export type ModelDefinition = {
  id: string
  displayName: string
  providerId: string
  tier: ModelTier
  contextWindow: number
  maxOutputTokens?: number
  capabilities: string[]
  pricing?: {
    inputPer1k?: number
    outputPer1k?: number
    combinedPer1k?: number
  }
}

export type ProviderDefinition = {
  providerId: string
  displayName: string
  group: 'official' | 'cloud' | 'local' | 'custom'
  baseUrl: string
  apiFormat: ApiFormat
  authStrategy?: ProviderAuthStrategy
  needsApiKey: boolean
  websiteUrl?: string
  apiKeyUrl?: string
  defaultModelRoles: ModelRoles
  defaultEnv?: Record<string, string>
  models: ModelDefinition[]
}

export type ProviderCatalog = {
  schemaVersion: 1
  providers: ProviderDefinition[]
  modelTiers: Record<ModelTier, Array<{ providerId: string; modelId: string }>>
}
