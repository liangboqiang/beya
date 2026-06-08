import * as fs from 'fs'
import * as path from 'path'

import {
  getModelContextWindows,
  getProviderDefinition,
  PROVIDER_CATALOG,
} from '../config/providerCatalog.js'
import type {
  ApiFormat,
  ModelRoles,
  ProviderAuthStrategy,
  ProvidersIndex,
  SavedProvider,
} from '../types/provider.js'
import {
  ATTRIBUTION_HEADER_ENV_KEY,
  attributionHeaderEnvForModel,
} from './attributionHeaderPolicy.js'
import { MODEL_CONTEXT_WINDOWS_ENV_KEY } from '../../utils/model/modelContextWindows.js'
import { normalizeProviderBaseUrl } from './providerEndpoint.js'

const OPENAI_OAUTH_PROVIDER_ENV_KEY = 'BEYA_OPENAI_OAUTH_PROVIDER'
const OPENAI_CODEX_OAUTH_FILE_ENV_KEY = 'OPENAI_CODEX_OAUTH_FILE'

export const MANAGED_PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'BEYA_SEND_DISABLED_THINKING',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  ATTRIBUTION_HEADER_ENV_KEY,
  MODEL_CONTEXT_WINDOWS_ENV_KEY,
  OPENAI_OAUTH_PROVIDER_ENV_KEY,
  OPENAI_CODEX_OAUTH_FILE_ENV_KEY,
] as const

const CUSTOM_PROVIDER_MODEL_CAPABILITIES = 'thinking,effort,adaptive_thinking,max_effort'
const AUTH_ENV_KEYS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isModelRoles(value: unknown): value is ModelRoles {
  return (
    isRecord(value) &&
    typeof value.primary === 'string' &&
    typeof value.fast === 'string' &&
    typeof value.balanced === 'string' &&
    typeof value.powerful === 'string'
  )
}

function isSavedProvider(value: unknown): value is SavedProvider {
  if (!isRecord(value)) return false
  const runtimeKind = value.runtimeKind
  return (
    typeof value.providerId === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.apiKey === 'string' &&
    typeof value.baseUrl === 'string' &&
    isModelRoles(value.modelRoles) &&
    (
      runtimeKind === undefined ||
      runtimeKind === 'anthropic_compatible'
    )
  )
}

export function normalizeModelRoles(modelRoles: ModelRoles): ModelRoles {
  const primary = modelRoles.primary.trim()
  return {
    primary,
    fast: modelRoles.fast.trim() || primary,
    balanced: modelRoles.balanced.trim() || primary,
    powerful: modelRoles.powerful.trim() || primary,
  }
}

export function resolveModelRoles(input: { modelRoles: ModelRoles }): ModelRoles {
  return normalizeModelRoles(input.modelRoles)
}

export function normalizeSavedProvider(provider: SavedProvider): SavedProvider {
  const definition = getProviderDefinition(provider.providerId)
  const apiFormat = provider.apiFormat ?? definition?.apiFormat ?? 'anthropic'
  const modelRoles = resolveModelRoles(provider)
  const enabledModels = provider.enabledModels?.length
    ? provider.enabledModels
    : [...new Set(Object.values(modelRoles).filter(Boolean))]
  return {
    ...provider,
    displayName: provider.displayName || definition?.displayName || provider.providerId,
    authStrategy: provider.authStrategy ?? definition?.authStrategy,
    baseUrl: normalizeProviderBaseUrl(provider.baseUrl || definition?.baseUrl || '', apiFormat),
    apiFormat,
    runtimeKind: provider.runtimeKind ?? 'anthropic_compatible',
    modelRoles,
    enabledModels,
  }
}

export function normalizeProvidersIndex(value: unknown): ProvidersIndex | null {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return null
  }

  const {
    activeId: _activeId,
    providers: _providers,
    schemaVersion: _schemaVersion,
    activeProviderId: _legacyActiveProviderId,
    ...rest
  } = value
  void _activeId
  void _providers
  void _schemaVersion
  void _legacyActiveProviderId
  const providers = value.providers
    .filter(isSavedProvider)
    .map((provider) => normalizeSavedProvider(provider))
  const rawActiveId = typeof value.activeId === 'string' ? value.activeId : null
  const activeId = rawActiveId && providers.some((provider) => provider.providerId === rawActiveId)
    ? rawActiveId
    : null

  return {
    ...rest,
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 1,
    activeId,
    providers,
  }
}

export function getProviderDefaultEnv(providerId: string): Record<string, string> {
  return getProviderDefinition(providerId)?.defaultEnv ?? {}
}

function omitAuthEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !AUTH_ENV_KEYS.has(key.toUpperCase())),
  )
}

export function getProviderAuthStrategy(providerId: string): ProviderAuthStrategy {
  return getProviderDefinition(providerId)?.authStrategy ?? 'api_key'
}

function getProviderModelContextWindows(providerId: string): Record<string, number> {
  return getModelContextWindows(providerId)
}

export function buildProviderAuthEnv(
  provider: SavedProvider,
  providerDefaultEnv: Record<string, string>,
  needsProxy: boolean,
): Record<string, string> {
  if (needsProxy) {
    return { ANTHROPIC_API_KEY: 'proxy-managed' }
  }

  const strategy = provider.authStrategy ?? getProviderAuthStrategy(provider.providerId)
  const key = provider.apiKey || providerDefaultEnv.ANTHROPIC_AUTH_TOKEN || providerDefaultEnv.ANTHROPIC_API_KEY || ''

  switch (strategy) {
    case 'api_key':
      return key ? { ANTHROPIC_API_KEY: key } : {}
    case 'auth_token':
    case 'auth_token_empty_api_key':
      return {
        ANTHROPIC_API_KEY: '',
        ...(key ? { ANTHROPIC_AUTH_TOKEN: key } : {}),
      }
    case 'dual_same_token':
      return key ? { ANTHROPIC_API_KEY: key, ANTHROPIC_AUTH_TOKEN: key } : {}
    case 'dual_dummy':
      return { ANTHROPIC_API_KEY: 'dummy', ANTHROPIC_AUTH_TOKEN: 'dummy' }
  }
}

export function getManagedEnvKeys(): string[] {
  const keys = new Set<string>(MANAGED_PROVIDER_ENV_KEYS)
  for (const provider of PROVIDER_CATALOG.providers) {
    for (const key of Object.keys(provider.defaultEnv ?? {})) {
      keys.add(key)
    }
  }
  return [...keys]
}

export function buildProviderManagedEnv(
  provider: SavedProvider,
  options?: { proxyPath?: string; serverPort?: number },
): Record<string, string> {
  const normalizedProvider = normalizeSavedProvider(provider)
  const apiFormat: ApiFormat = normalizedProvider.apiFormat ?? 'anthropic'
  const needsProxy = apiFormat !== 'anthropic'
  const proxyPath = options?.proxyPath ?? '/proxy'
  const serverPort = options?.serverPort ?? 3456
  const baseUrl = needsProxy
    ? `http://127.0.0.1:${serverPort}${proxyPath}`
    : normalizedProvider.baseUrl

  const modelRoles = resolveModelRoles(normalizedProvider)
  const modelContextWindows = {
    ...getProviderModelContextWindows(normalizedProvider.providerId),
    ...(normalizedProvider.modelContextWindows ?? {}),
  }

  const providerDefaultEnv = getProviderDefaultEnv(normalizedProvider.providerId)
  const customProviderCapabilityEnv =
    normalizedProvider.providerId === 'custom'
      ? {
          ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: CUSTOM_PROVIDER_MODEL_CAPABILITIES,
          ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: CUSTOM_PROVIDER_MODEL_CAPABILITIES,
          ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: CUSTOM_PROVIDER_MODEL_CAPABILITIES,
        }
      : {}

  return {
    ...omitAuthEnv(providerDefaultEnv),
    ...customProviderCapabilityEnv,
    ...(normalizedProvider.autoCompactWindow !== undefined && {
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(normalizedProvider.autoCompactWindow),
    }),
    ...(Object.keys(modelContextWindows).length > 0 && {
      [MODEL_CONTEXT_WINDOWS_ENV_KEY]: JSON.stringify(modelContextWindows),
    }),
    ANTHROPIC_BASE_URL: baseUrl,
    ...buildProviderAuthEnv(normalizedProvider, providerDefaultEnv, needsProxy),
    ANTHROPIC_MODEL: modelRoles.primary,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: modelRoles.fast,
    ANTHROPIC_DEFAULT_SONNET_MODEL: modelRoles.balanced,
    ANTHROPIC_DEFAULT_OPUS_MODEL: modelRoles.powerful,
    ...attributionHeaderEnvForModel(modelRoles.primary),
  }
}

export function readActiveProviderManagedEnv(
  configDir: string,
  options?: { serverPort?: number },
): Record<string, string> | null {
  try {
    const raw = fs.readFileSync(path.join(configDir, 'beya', 'providers.json'), 'utf-8')
    const index = normalizeProvidersIndex(JSON.parse(raw))
    if (!index?.activeId) return null

    const provider = index.providers.find((entry) => entry.providerId === index.activeId)
    if (!provider) return null

    return buildProviderManagedEnv(provider, {
      serverPort: options?.serverPort,
    })
  } catch {
    return null
  }
}

export function mergeActiveProviderManagedEnv(
  settingsEnv: Record<string, string>,
  configDir: string,
  options?: { serverPort?: number },
): Record<string, string> {
  const activeProviderEnv = readActiveProviderManagedEnv(configDir, options)
  if (!activeProviderEnv) {
    return settingsEnv
  }

  const cleanedEnv = { ...settingsEnv }
  for (const key of getManagedEnvKeys()) {
    delete cleanedEnv[key]
  }
  return {
    ...cleanedEnv,
    ...activeProviderEnv,
  }
}
