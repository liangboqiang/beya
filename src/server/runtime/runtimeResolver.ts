import {
  getProviderDefinition,
  getProviderModels,
  type ModelDefinition,
} from '../config/providerCatalog.js'
import {
  localCliRuntimeService,
  type LocalCliRuntimeInfo,
  type LocalCliRuntimeService,
  type SelectedLocalCliRuntime,
} from '../services/localCliRuntimeService.js'
import { ProviderService } from '../services/providerService.js'
import type { ExecutionMode } from '../services/executionModeService.js'
import type { SavedProvider } from '../types/provider.js'
import type {
  LocalCliRuntimeProfile,
  ProviderRuntimeProfile,
  ResolvedRuntime,
  RuntimeCapabilities,
  RuntimeModel,
  RuntimeProfile,
} from './protocol.js'
import { resolveProviderRequestPolicy } from './providerPolicy.js'

const VALID_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'max'])

export class RuntimeResolutionError extends Error {
  constructor(message: string, readonly code = 'RUNTIME_CONFIG_INVALID') {
    super(message)
    this.name = 'RuntimeResolutionError'
  }
}

export type RuntimeSelectionInput = {
  kind?: 'provider' | 'local_cli'
  providerId?: string | null
  localCliId?: string | null
  modelId?: string | null
  effortLevel?: string | null
  effort?: string | null
}

export type RuntimeDefaultInput = {
  executionMode: ExecutionMode
  requestedModelId?: string | null
  effort?: string | null
}

function sanitizeRuntimeModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 200) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(trimmed)) return null
  return trimmed
}

function splitRuntimeModelContext(modelId: string): { base: string; contextSuffix: string } {
  const colon = modelId.indexOf(':')
  if (colon === -1) return { base: modelId, contextSuffix: '' }
  return {
    base: modelId.slice(0, colon),
    contextSuffix: modelId.slice(colon),
  }
}

function uniqueModelIds(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function providerModelCandidates(provider: SavedProvider): string[] {
  return uniqueModelIds([
    ...(provider.enabledModels ?? []),
    provider.modelRoles?.primary,
    provider.modelRoles?.fast,
    provider.modelRoles?.balanced,
    provider.modelRoles?.powerful,
  ])
}

function localCliModelCandidates(cli: LocalCliRuntimeInfo): string[] {
  return uniqueModelIds([
    ...(cli.models ?? []).map((model) => model.id),
    cli.modelRoles?.primary,
    cli.modelRoles?.fast,
    cli.modelRoles?.balanced,
    cli.modelRoles?.powerful,
  ])
}

function selectedLocalCliModelCandidates(cli: SelectedLocalCliRuntime): string[] {
  return uniqueModelIds([
    cli.modelRoles?.primary,
    cli.modelRoles?.fast,
    cli.modelRoles?.balanced,
    cli.modelRoles?.powerful,
  ])
}

function resolveProviderModel(
  provider: SavedProvider,
  requestedModelId?: string | null,
): string | null {
  const candidates = providerModelCandidates(provider)
  const candidateSet = new Set(candidates)
  const requested = sanitizeRuntimeModelId(requestedModelId)
  if (requested) {
    const { base, contextSuffix } = splitRuntimeModelContext(requested)
    if (candidateSet.has(base)) return `${base}${contextSuffix}`
  }

  const fallback = uniqueModelIds([
    provider.modelRoles?.primary,
    provider.modelRoles?.fast,
    provider.modelRoles?.balanced,
    provider.modelRoles?.powerful,
  ])[0]
  if (fallback && candidateSet.has(fallback)) {
    const requestedContext = requested ? splitRuntimeModelContext(requested).contextSuffix : ''
    return `${fallback}${requestedContext}`
  }

  if (candidates.length > 0) {
    const requestedContext = requested ? splitRuntimeModelContext(requested).contextSuffix : ''
    return `${candidates[0]}${requestedContext}`
  }

  return requested
}

function resolveLocalCliModel(
  cli: LocalCliRuntimeInfo,
  requestedModelId?: string | null,
): string | null {
  const candidates = localCliModelCandidates(cli)
  const candidateSet = new Set(candidates)
  const requested = sanitizeRuntimeModelId(requestedModelId)
  if (requested) {
    const { base } = splitRuntimeModelContext(requested)
    if (candidateSet.has(base) || requested === 'default') return requested
  }
  const fallback = uniqueModelIds([
    cli.modelRoles?.primary,
    cli.modelRoles?.fast,
    cli.modelRoles?.balanced,
    cli.modelRoles?.powerful,
  ]).find((id) => candidateSet.has(id))
  if (fallback) return fallback
  return candidates[0] ?? null
}

function resolveSelectedLocalCliModel(
  cli: SelectedLocalCliRuntime,
  requestedModelId?: string | null,
): string {
  const candidates = selectedLocalCliModelCandidates(cli)
  const candidateSet = new Set(candidates)
  const requested = sanitizeRuntimeModelId(requestedModelId)
  if (requested) {
    const { base } = splitRuntimeModelContext(requested)
    if (candidateSet.has(base) || requested === 'default') return requested
  }
  return candidates[0] ?? 'default'
}

function modelDefinitionById(providerId: string): Map<string, ModelDefinition> {
  return new Map(getProviderModels(providerId).map((model) => [model.id, model]))
}

function providerRuntimeModels(provider: SavedProvider): RuntimeModel[] {
  const definitions = modelDefinitionById(provider.providerId)
  return providerModelCandidates(provider).map((modelId) => {
    const base = splitRuntimeModelContext(modelId).base
    const definition = definitions.get(base)
    const contextWindow =
      provider.modelContextWindows?.[base] ??
      provider.modelContextWindows?.[modelId] ??
      definition?.contextWindow
    return {
      id: modelId,
      displayName: definition?.displayName ?? modelId,
      ...(contextWindow ? { contextWindow } : {}),
      ...(definition?.maxOutputTokens ? { maxOutputTokens: definition.maxOutputTokens } : {}),
      ...(definition?.capabilities ? { capabilities: definition.capabilities } : {}),
    }
  })
}

function localCliRuntimeModels(cli: LocalCliRuntimeInfo): RuntimeModel[] {
  const modelOptions = cli.models?.length
    ? cli.models
    : localCliModelCandidates(cli).map((id) => ({ id, label: id }))
  const seen = new Set<string>()
  return modelOptions.flatMap((model) => {
    const id = model.id.trim()
    if (!id || seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      displayName: model.label?.trim() || id,
      ...(cli.modelContextWindows?.[id] ? { contextWindow: cli.modelContextWindows[id] } : {}),
    }]
  })
}

function selectedLocalCliRuntimeModels(cli: SelectedLocalCliRuntime): RuntimeModel[] {
  return selectedLocalCliModelCandidates(cli).map((id) => ({
    id,
    displayName: id,
    ...(cli.modelContextWindows?.[id] ? { contextWindow: cli.modelContextWindows[id] } : {}),
  }))
}

function providerCapabilities(provider: SavedProvider): RuntimeCapabilities {
  const policy = resolveProviderRequestPolicy(provider)
  const runtimeModels = providerRuntimeModels(provider)
  const modelCapabilities = runtimeModels.flatMap((model) => model.capabilities ?? [])
  const isCustom = provider.providerId === 'custom'

  return {
    streaming: true,
    tools: 'native',
    contextUsage: 'actual',
    tokenUsage: 'actual',
    prewarm: true,
    resume: 'native',
    vision: !isCustom && policy.imageMode !== 'unsupported' && modelCapabilities.includes('vision'),
    thinking: policy.reasoningMode === 'native' &&
      modelCapabilities.some((capability) => capability === 'thinking' || capability === 'reasoning'),
    promptInput: 'sdk',
  }
}

function localCliCapabilities(localCliId: string): RuntimeCapabilities {
  const known = localCliId === 'codex' || localCliId === 'claude'
  return {
    streaming: false,
    tools: known ? 'limited' : 'none',
    contextUsage: 'unavailable',
    tokenUsage: 'unavailable',
    prewarm: false,
    resume: localCliId === 'claude' ? 'native' : localCliId === 'codex' ? 'beya_transcript' : 'none',
    vision: false,
    thinking: false,
    promptInput: 'stdin',
  }
}

export function toProviderRuntimeProfile(
  provider: SavedProvider,
  defaultModelId?: string | null,
): ProviderRuntimeProfile {
  const models = providerRuntimeModels(provider)
  const fallbackModelId = defaultModelId || resolveProviderModel(provider) || models[0]?.id || ''
  return {
    id: `provider:${provider.providerId}`,
    kind: 'provider',
    providerId: provider.providerId,
    displayName: provider.displayName,
    defaultModelId: fallbackModelId,
    models,
    capabilities: providerCapabilities(provider),
    apiFormat: provider.apiFormat ?? getProviderDefinition(provider.providerId)?.apiFormat ?? 'anthropic',
    baseUrl: provider.baseUrl,
    authStrategy: provider.authStrategy ?? getProviderDefinition(provider.providerId)?.authStrategy ?? 'none',
    requestPolicy: resolveProviderRequestPolicy(provider),
  }
}

export function toLocalCliRuntimeProfile(
  cli: LocalCliRuntimeInfo,
  defaultModelId?: string | null,
): LocalCliRuntimeProfile {
  const models = localCliRuntimeModels(cli)
  return buildLocalCliRuntimeProfile({
    id: cli.id,
    displayName: cli.displayName,
    bin: cli.launchPath ?? cli.executablePath ?? cli.command,
    defaultModelId: defaultModelId || resolveLocalCliModel(cli) || models[0]?.id || 'default',
    models,
  })
}

export function toSelectedLocalCliRuntimeProfile(
  cli: SelectedLocalCliRuntime,
  defaultModelId?: string | null,
): LocalCliRuntimeProfile {
  const models = selectedLocalCliRuntimeModels(cli)
  return buildLocalCliRuntimeProfile({
    id: cli.id,
    displayName: cli.displayName,
    bin: cli.launchPath,
    defaultModelId: defaultModelId || resolveSelectedLocalCliModel(cli) || models[0]?.id || 'default',
    models,
  })
}

function buildLocalCliRuntimeProfile(input: {
  id: string
  displayName: string
  bin: string
  defaultModelId: string
  models: RuntimeModel[]
}): LocalCliRuntimeProfile {
  const localCliId = input.id
  const isCodex = localCliId === 'codex'
  const isClaude = localCliId === 'claude'
  return {
    id: `local_cli:${localCliId}`,
    kind: 'local_cli',
    localCliId,
    displayName: input.displayName,
    defaultModelId: input.defaultModelId || 'default',
    models: input.models.length > 0 ? input.models : [{ id: 'default', displayName: 'CLI default' }],
    capabilities: localCliCapabilities(localCliId),
    bin: input.bin,
    streamFormat: isClaude ? 'stream-json' : isCodex ? 'jsonl' : 'plain',
    promptViaStdin: true,
    promptInputFormat: isClaude ? 'stream-json' : 'text',
    parser: isClaude ? 'claude' : isCodex ? 'codex' : 'plain',
    maxPromptArgBytes: isCodex || isClaude ? undefined : 16_000,
    resumesSessionViaCli: isClaude,
  }
}

function validateEffort(input: RuntimeSelectionInput): string | undefined {
  const effort = typeof input.effortLevel === 'string'
    ? input.effortLevel.trim()
    : typeof input.effort === 'string'
      ? input.effort.trim()
      : ''
  if (!effort) return undefined
  if (!VALID_EFFORT_LEVELS.has(effort)) {
    throw new RuntimeResolutionError('Runtime effort selection is invalid.')
  }
  return effort
}

function selectedKind(input: RuntimeSelectionInput): 'provider' | 'local_cli' {
  return input.kind === 'local_cli' || input.localCliId ? 'local_cli' : 'provider'
}

export class RuntimeResolver {
  constructor(
    private readonly providerService = new ProviderService(),
    private readonly localCliService: LocalCliRuntimeService = localCliRuntimeService,
  ) {}

  async resolve(input: RuntimeSelectionInput): Promise<ResolvedRuntime> {
    const effort = validateEffort(input)
    const kind = selectedKind(input)

    if (kind === 'local_cli') {
      const localCliId = typeof input.localCliId === 'string' && input.localCliId.trim()
        ? input.localCliId.trim()
        : null
      if (!localCliId) {
        throw new RuntimeResolutionError('Local CLI runtime selection is invalid.')
      }

      const { clis } = await this.localCliService.listLocalClis()
      const cli = clis.find((candidate) => candidate.id === localCliId && candidate.available)
      if (!cli) {
        throw new RuntimeResolutionError('Selected local CLI is no longer available.')
      }
      const modelId = resolveLocalCliModel(cli, input.modelId)
      if (!modelId) {
        throw new RuntimeResolutionError('Local CLI runtime model selection is invalid.')
      }
      return {
        kind: 'local_cli',
        providerId: null,
        localCliId: cli.id,
        modelId,
        ...(effort ? { effort } : {}),
        profile: toLocalCliRuntimeProfile(cli, modelId),
      }
    }

    const { providers, activeId } = await this.providerService.listProviders()
    const requestedProviderId =
      typeof input.providerId === 'string' && input.providerId.trim()
        ? input.providerId.trim()
        : activeId
    if (!requestedProviderId) {
      throw new RuntimeResolutionError('Provider runtime selection is invalid: no active provider is configured.')
    }
    const provider = providers.find((entry) => entry.providerId === requestedProviderId)
    if (!provider) {
      throw new RuntimeResolutionError(`Provider runtime is not configured: ${requestedProviderId}`)
    }
    const modelId = resolveProviderModel(provider, input.modelId)
    if (!modelId) {
      throw new RuntimeResolutionError('Provider runtime model selection is invalid.')
    }
    return {
      kind: 'provider',
      providerId: provider.providerId,
      localCliId: null,
      modelId,
      ...(effort ? { effort } : {}),
      profile: toProviderRuntimeProfile(provider, modelId),
    }
  }

  async resolveDefault(input: RuntimeDefaultInput): Promise<ResolvedRuntime> {
    if (input.executionMode === 'local_cli') {
      const { activeId, clis } = await this.localCliService.listLocalClis()
      const cli =
        clis.find((candidate) => candidate.id === activeId && candidate.available) ??
        clis.find((candidate) => candidate.available)
      if (!cli) {
        throw new RuntimeResolutionError('Local CLI execution mode is enabled, but no local CLI is available.')
      }
      return this.resolve({
        kind: 'local_cli',
        localCliId: cli.id,
        modelId: input.requestedModelId,
        effort: input.effort,
      })
    }

    const { activeId } = await this.providerService.listProviders()
    if (!activeId) {
      throw new RuntimeResolutionError('Provider execution mode is enabled, but no active provider is configured.')
    }
    return this.resolve({
      kind: 'provider',
      providerId: activeId,
      modelId: input.requestedModelId,
      effort: input.effort,
    })
  }

  canPrewarm(profile: RuntimeProfile): boolean {
    return profile.capabilities.prewarm
  }
}

export const runtimeResolver = new RuntimeResolver()
