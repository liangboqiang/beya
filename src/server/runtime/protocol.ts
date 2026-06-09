import type { ApiFormat, ProviderAuthStrategy } from '../types/provider.js'

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

export type RuntimeUsage = {
  status: CapabilitySupport
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  totalTokens?: number
  costUsd?: number
  source: 'provider' | 'local_cli' | 'transcript_estimate' | 'none'
}

export type RuntimeContextUsage = {
  status: CapabilitySupport
  totalTokens?: number
  maxTokens?: number
  percentage?: number
  model?: string
  source: 'control_channel' | 'transcript_estimate' | 'none'
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

export type ProviderRequestPolicy = {
  stripParams?: string[]
  extraBody?: Record<string, unknown>
  imageMode?: 'native' | 'text_only' | 'unsupported'
  reasoningMode?: 'native' | 'disabled' | 'unsupported'
  usageTrust: 'high' | 'medium' | 'low'
}

export type ProviderRuntimeProfile = RuntimeProfile & {
  kind: 'provider'
  providerId: string
  apiFormat: ApiFormat
  baseUrl: string
  authStrategy: ProviderAuthStrategy | 'none'
  requestPolicy: ProviderRequestPolicy
}

export type LocalCliRuntimeProfile = RuntimeProfile & {
  kind: 'local_cli'
  localCliId: string
  bin: string
  streamFormat: 'plain' | 'jsonl' | 'stream-json'
  promptViaStdin: boolean
  promptInputFormat?: 'text' | 'stream-json'
  parser: 'codex' | 'claude' | 'plain'
  maxPromptArgBytes?: number
  resumesSessionViaCli: boolean
}

export type ResolvedRuntime = {
  kind: RuntimeKind
  providerId: string | null
  localCliId: string | null
  modelId: string
  effort?: string
  profile: ProviderRuntimeProfile | LocalCliRuntimeProfile
}

export type RuntimeTelemetry = {
  usage: RuntimeUsage
  contextUsage: RuntimeContextUsage
}

export function unavailableRuntimeUsage(
  source: RuntimeUsage['source'] = 'none',
): RuntimeUsage {
  return {
    status: 'unavailable',
    source,
  }
}

export function unavailableRuntimeContextUsage(
  source: RuntimeContextUsage['source'] = 'none',
): RuntimeContextUsage {
  return {
    status: 'unavailable',
    source,
  }
}

export function contextTelemetryFromSnapshot(snapshot: unknown): RuntimeContextUsage {
  if (!snapshot || typeof snapshot !== 'object') {
    return unavailableRuntimeContextUsage()
  }
  const record = snapshot as Record<string, unknown>
  return {
    status: 'actual',
    totalTokens: typeof record.totalTokens === 'number' ? record.totalTokens : undefined,
    maxTokens: typeof record.rawMaxTokens === 'number'
      ? record.rawMaxTokens
      : typeof record.maxTokens === 'number'
        ? record.maxTokens
        : undefined,
    percentage: typeof record.percentage === 'number' ? record.percentage : undefined,
    model: typeof record.model === 'string' ? record.model : undefined,
    source: 'control_channel',
  }
}
