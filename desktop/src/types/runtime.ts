import type { EffortLevel } from './settings'

export type RuntimeKind = 'provider' | 'local_cli'
export type CapabilitySupport = 'actual' | 'estimated' | 'unavailable'

export type RuntimeCapabilities = {
  streaming: boolean
  tools: 'native' | 'limited' | 'none'
  contextUsage: CapabilitySupport
  tokenUsage: CapabilitySupport
  prewarm: boolean
  resume: 'native' | 'beya_transcript' | 'none'
  vision: boolean
  thinking: boolean
  promptInput: 'sdk' | 'stdin' | 'argv'
}

export type RuntimeModel = {
  id: string
  displayName: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities?: string[]
}

export type RuntimeProfile = {
  id: string
  kind: RuntimeKind
  displayName: string
  defaultModelId: string
  models: RuntimeModel[]
  capabilities: RuntimeCapabilities
}

export type RuntimeSelection = {
  kind?: 'provider' | 'local_cli'
  providerId: string | null
  localCliId?: string | null
  modelId: string
  effortLevel?: EffortLevel
}
