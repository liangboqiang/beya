/**
 * Provider Service — preset-based provider configuration
 *
 * Storage: Beya provider index and managed settings.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'
import { readRecoverableJsonFile } from './recoverableJsonFile.js'
import { ManagedSettingsService } from './managedSettingsService.js'
import { getProviderDefinition } from '../config/providerCatalog.js'
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js'
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js'
import type { AnthropicRequest } from '../proxy/transform/types.js'
import {
  OPENAI_OFFICIAL_PROVIDER,
  isOpenAIOfficialProviderId,
} from './openaiOfficialProvider.js'
import { beyaOpenAIOAuthService } from './beyaOpenAIOAuthService.js'
import {
  CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
  ensurePersistentStorageUpgraded,
} from './persistentStorageMigrations.js'
import {
  buildProviderAuthEnv,
  buildProviderManagedEnv,
  getManagedEnvKeys,
  getProviderAuthStrategy,
  getProviderDefaultEnv,
  normalizeProvidersIndex,
  resolveModelRoles,
} from './providerRuntimeEnv.js'
import { normalizeProviderBaseUrl, resolveProviderUpstreamUrl } from './providerEndpoint.js'
import { getProxyFetchOptions } from '../../utils/proxy.js'
import {
  getManualNetworkProxyUrl,
  loadNetworkSettings,
  type NetworkSettings,
} from './networkSettings.js'
import type {
  SavedProvider,
  ProvidersIndex,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderInput,
  ProviderTestResult,
  ProviderTestStepResult,
  ApiFormat,
  ProviderAuthStrategy,
} from '../types/provider.js'

const DEFAULT_INDEX: ProvidersIndex = {
  schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
  activeId: null,
  providers: [],
}

function providerForStorage(provider: SavedProvider): SavedProvider {
  return provider
}

function indexForStorage(index: ProvidersIndex): ProvidersIndex {
  return {
    ...index,
    schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
    providers: index.providers.map(providerForStorage),
  }
}

export class ProviderService {
  private static serverPort = 3456
  private managedSettingsService = new ManagedSettingsService()

  static setServerPort(port: number): void {
    ProviderService.serverPort = port
  }

  static getServerPort(): number {
    return ProviderService.serverPort
  }
  private getConfigDir(): string {
    return process.env.BEYA_CONFIG_DIR || path.join(os.homedir(), '.beya')
  }

  private getBeyaDir(): string {
    return path.join(this.getConfigDir(), 'beya')
  }

  private getIndexPath(): string {
    return path.join(this.getBeyaDir(), 'providers.json')
  }

  private async readIndex(): Promise<ProvidersIndex> {
    await ensurePersistentStorageUpgraded()
    return readRecoverableJsonFile({
      filePath: this.getIndexPath(),
      label: 'providers index',
      defaultValue: DEFAULT_INDEX,
      normalize: normalizeProvidersIndex,
    })
  }

  private async writeIndex(index: ProvidersIndex): Promise<void> {
    const filePath = this.getIndexPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(indexForStorage(index), null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write providers index: ${err}`)
    }
  }

  private async readSettings(): Promise<Record<string, unknown>> {
    return this.managedSettingsService.readSettings()
  }

  async getManagedSettings(): Promise<Record<string, unknown>> {
    return this.readSettings()
  }

  async updateManagedSettings(settings: Record<string, unknown>): Promise<void> {
    await this.managedSettingsService.updateSettings((current) => ({
      settings: Object.assign({}, current, settings),
      result: undefined,
    }))
  }

  // --- CRUD ---

  async listProviders(): Promise<{ providers: SavedProvider[]; activeId: string | null }> {
    const index = await this.readIndex()
    return { providers: index.providers, activeId: index.activeId }
  }

  async getProvider(id: string): Promise<SavedProvider> {
    if (isOpenAIOfficialProviderId(id)) {
      return OPENAI_OFFICIAL_PROVIDER
    }

    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.providerId === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)
    return provider
  }

  async addProvider(input: CreateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()
    const definition = getProviderDefinition(input.providerId)
    const modelRoles = resolveModelRoles(input)
    if (!modelRoles.primary) {
      throw ApiError.badRequest('Missing primary model role')
    }

    const provider: SavedProvider = {
      providerId: input.providerId,
      displayName: input.displayName,
      apiKey: input.apiKey,
      authStrategy: input.authStrategy ?? definition?.authStrategy,
      baseUrl: normalizeProviderBaseUrl(input.baseUrl, input.apiFormat ?? definition?.apiFormat ?? 'anthropic'),
      apiFormat: input.apiFormat ?? definition?.apiFormat ?? 'anthropic',
      runtimeKind: input.runtimeKind ?? 'anthropic_compatible',
      modelRoles,
      enabledModels: input.enabledModels?.length
        ? input.enabledModels
        : [...new Set(Object.values(modelRoles).filter(Boolean))],
      ...(input.connectionOverrides !== undefined && { connectionOverrides: input.connectionOverrides }),
      ...(input.autoCompactWindow !== undefined && { autoCompactWindow: input.autoCompactWindow }),
      ...(input.modelContextWindows !== undefined && { modelContextWindows: input.modelContextWindows }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }

    const existingIndex = index.providers.findIndex((p) => p.providerId === provider.providerId)
    if (existingIndex === -1) {
      index.providers.push(provider)
    } else {
      index.providers[existingIndex] = provider
    }
    await this.writeIndex(index)
    return provider
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.providerId === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    const existing = index.providers[idx]
    const nextModelRoles = input.modelRoles !== undefined
      ? resolveModelRoles(input)
      : undefined
    if (nextModelRoles && !nextModelRoles.primary) {
      throw ApiError.badRequest('Missing primary model role')
    }
    const nextApiFormat = input.apiFormat ?? existing.apiFormat
    const updated: SavedProvider = {
      ...existing,
      ...(input.displayName !== undefined && { displayName: input.displayName }),
      ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
      ...(input.authStrategy !== undefined && { authStrategy: input.authStrategy }),
      ...(input.baseUrl !== undefined && { baseUrl: normalizeProviderBaseUrl(input.baseUrl, nextApiFormat) }),
      ...(input.apiFormat !== undefined && { apiFormat: input.apiFormat }),
      ...(input.runtimeKind !== undefined && { runtimeKind: input.runtimeKind }),
      ...(nextModelRoles && {
        modelRoles: nextModelRoles,
        enabledModels: input.enabledModels?.length
          ? input.enabledModels
          : [...new Set(Object.values(nextModelRoles).filter(Boolean))],
      }),
      ...(input.enabledModels !== undefined && !nextModelRoles && { enabledModels: input.enabledModels }),
      ...(input.connectionOverrides !== undefined && { connectionOverrides: input.connectionOverrides }),
      ...(typeof input.autoCompactWindow === 'number' && { autoCompactWindow: input.autoCompactWindow }),
      ...(input.modelContextWindows !== undefined && input.modelContextWindows !== null && { modelContextWindows: input.modelContextWindows }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    if (input.autoCompactWindow === null) {
      delete updated.autoCompactWindow
    }
    if (input.modelContextWindows === null) {
      delete updated.modelContextWindows
    }

    index.providers[idx] = updated
    await this.writeIndex(index)

    if (index.activeId === id) {
      await this.syncToSettings(updated)
    }

    return updated
  }

  async deleteProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.providerId === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    if (index.activeId === id) {
      throw ApiError.conflict('Cannot delete the active provider. Switch to another provider first.')
    }

    index.providers.splice(idx, 1)
    await this.writeIndex(index)
  }

  // --- Activation ---

  async activateProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const provider = isOpenAIOfficialProviderId(id)
      ? OPENAI_OFFICIAL_PROVIDER
      : index.providers.find((p) => p.providerId === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)

    index.activeId = id
    await this.writeIndex(index)

    await this.syncToSettings(provider)
  }

  async deactivateProvider(): Promise<void> {
    const index = await this.readIndex()
    index.activeId = null
    await this.writeIndex(index)
    await this.clearManagedProviderEnv()
  }

  // --- Settings sync ---

  private buildManagedEnv(
    provider: SavedProvider,
    options?: { proxyPath?: string },
  ): Record<string, string> {
    return buildProviderManagedEnv(provider, {
      proxyPath: options?.proxyPath,
      serverPort: ProviderService.serverPort,
    })
  }

  async getProviderRuntimeEnv(id: string): Promise<Record<string, string>> {
    const provider = await this.getProvider(id)
    return this.buildManagedEnv(provider, {
      proxyPath: `/proxy/providers/${provider.providerId}`,
    })
  }

  private async syncToSettings(provider: SavedProvider): Promise<void> {
    await this.managedSettingsService.updateSettings((settings) => {
      const existingEnv = (settings.env as Record<string, string>) || {}
      const cleanedEnv = { ...existingEnv }

      for (const key of getManagedEnvKeys()) {
        delete cleanedEnv[key]
      }

      return {
        settings: {
          ...settings,
          env: {
            ...cleanedEnv,
            ...this.buildManagedEnv(provider),
          },
        },
        result: undefined,
      }
    })
  }

  private async clearManagedProviderEnv(): Promise<void> {
    await this.managedSettingsService.updateSettings((settings) => {
      const existingEnv = (settings.env as Record<string, string>) || {}
      const cleanedEnv = { ...existingEnv }

      for (const key of getManagedEnvKeys()) {
        delete cleanedEnv[key]
      }

      return {
        settings: {
          ...settings,
          env: cleanedEnv,
        },
        result: undefined,
      }
    })
  }

  // --- Auth status ---
  async checkAuthStatus(): Promise<{
    hasAuth: boolean
    source: 'beya-provider' | 'openai-oauth' | 'env' | 'none'
    activeProvider?: string
  }> {
    const index = await this.readIndex()
    if (index.activeId) {
      if (isOpenAIOfficialProviderId(index.activeId)) {
        const tokens = await beyaOpenAIOAuthService.ensureFreshTokens()
        if (tokens?.accessToken && tokens.refreshToken) {
          return {
            hasAuth: true,
            source: 'openai-oauth',
            activeProvider: OPENAI_OFFICIAL_PROVIDER.displayName,
          }
        }
        return {
          hasAuth: false,
          source: 'none',
          activeProvider: OPENAI_OFFICIAL_PROVIDER.displayName,
        }
      }

      const provider = index.providers.find(p => p.providerId === index.activeId)
      if (provider) {
        const presetDefaultEnv = getProviderDefaultEnv(provider.providerId)
        const needsProxy = provider.apiFormat != null && provider.apiFormat !== 'anthropic'
        const authEnv = buildProviderAuthEnv(provider, presetDefaultEnv, needsProxy)
        if (Object.values(authEnv).some(value => value.length > 0)) {
          return { hasAuth: true, source: 'beya-provider', activeProvider: provider.displayName }
        }
      }
    }

    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      return { hasAuth: true, source: 'env' }
    }

    return { hasAuth: false, source: 'none' }
  }

  // --- Proxy support ---

  async getProviderForProxy(providerId?: string): Promise<{
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
  } | null> {
    if (providerId) {
      if (isOpenAIOfficialProviderId(providerId)) {
        return null
      }
      const provider = await this.getProvider(providerId)
      return {
        baseUrl: normalizeProviderBaseUrl(provider.baseUrl, provider.apiFormat ?? 'anthropic'),
        apiKey: provider.apiKey || 'local',
        apiFormat: provider.apiFormat ?? 'anthropic',
      }
    }

    const index = await this.readIndex()
    if (!index.activeId) return null
    if (isOpenAIOfficialProviderId(index.activeId)) {
      return null
    }
    const provider = await this.getProvider(index.activeId).catch(() => null)
    if (!provider) return null
    return {
      baseUrl: normalizeProviderBaseUrl(provider.baseUrl, provider.apiFormat ?? 'anthropic'),
      apiKey: provider.apiKey || 'local',
      apiFormat: provider.apiFormat ?? 'anthropic',
    }
  }

  async getActiveProviderForProxy(): Promise<{
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
  } | null> {
    return this.getProviderForProxy()
  }

  // --- Test ---

  async testProvider(
    id: string,
    overrides?: { baseUrl?: string; modelId?: string; apiFormat?: ApiFormat; authStrategy?: ProviderAuthStrategy },
  ): Promise<ProviderTestResult> {
    const provider = await this.getProvider(id)
    const baseUrl = overrides?.baseUrl || provider.baseUrl
    const modelId = overrides?.modelId || provider.modelRoles.primary
    const apiFormat = overrides?.apiFormat ?? provider.apiFormat ?? 'anthropic'
    const authStrategy = overrides?.authStrategy ?? provider.authStrategy ?? getProviderAuthStrategy(provider.providerId)
    const presetDefaultEnv = getProviderDefaultEnv(provider.providerId)
    const apiKey = provider.apiKey
      || presetDefaultEnv.ANTHROPIC_AUTH_TOKEN
      || presetDefaultEnv.ANTHROPIC_API_KEY
      || (getProviderDefinition(provider.providerId)?.needsApiKey === false ? 'local' : '')
      || (authStrategy === 'dual_dummy' ? 'dummy' : '')

    if (!baseUrl || !apiKey) {
      return { connectivity: { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' } }
    }
    return this.testProviderConfig({
      baseUrl,
      apiKey,
      modelId,
      authStrategy,
      apiFormat,
    })
  }

  async testProviderConfig(input: TestProviderInput): Promise<ProviderTestResult> {
    const format: ApiFormat = input.apiFormat ?? 'anthropic'
    const authStrategy = input.authStrategy ?? 'api_key'
    const base = normalizeProviderBaseUrl(input.baseUrl, format)
    const networkSettings = await loadNetworkSettings()

    // ── Step 1: Basic connectivity ───────────────────────────
    // Directly call the upstream API to verify URL, key, and model.
    const step1 = await this.testConnectivity(base, input.apiKey, input.modelId, format, authStrategy, networkSettings)

    // If connectivity failed, no point running step 2
    if (!step1.success) {
      return { connectivity: step1 }
    }

    // For native Anthropic format, no proxy pipeline to test
    if (format === 'anthropic') {
      return { connectivity: step1 }
    }

    // ── Step 2: Full proxy pipeline ──────────────────────────
    // Anthropic request → transform → upstream → transform back → validate
    const step2 = await this.testProxyPipeline(base, input.apiKey, input.modelId, format, networkSettings)

    return { connectivity: step1, proxy: step2 }
  }

  /** Step 1: Direct upstream call to verify connectivity, auth, and model. */
  private async testConnectivity(
    base: string,
    apiKey: string,
    modelId: string,
    format: ApiFormat,
    authStrategy: ProviderAuthStrategy,
    networkSettings: NetworkSettings,
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      const { url, headers, body } = buildDirectTestRequest(base, apiKey, modelId, format, authStrategy)
      const proxyOptions = getProxyFetchOptions({ proxyUrl: getManualNetworkProxyUrl(networkSettings) })
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(networkSettings.aiRequestTimeoutMs),
        ...proxyOptions,
      })

      const latencyMs = Date.now() - start
      const resBody = await response.json().catch(() => null) as Record<string, unknown> | null

      if (!response.ok) {
        let error = `HTTP ${response.status}`
        if (resBody?.error && typeof resBody.error === 'object') {
          error = ((resBody.error as Record<string, unknown>).message as string) || error
        }
        return { success: false, latencyMs, error, modelUsed: modelId, httpStatus: response.status }
      }

      // Validate response structure
      const valid = validateResponseBody(resBody, format)
      if (!valid.ok) {
        return { success: false, latencyMs, error: valid.error, modelUsed: modelId, httpStatus: response.status }
      }

      return { success: true, latencyMs, modelUsed: valid.model || modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: `Request timed out (${Math.round(networkSettings.aiRequestTimeoutMs / 1000)}s)`, modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }

  /** Step 2: Full proxy pipeline — Anthropic → transform → upstream → transform back → validate. */
  private async testProxyPipeline(
    base: string,
    apiKey: string,
    modelId: string,
    format: 'openai_chat' | 'openai_responses',
    networkSettings: NetworkSettings,
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      // Build an Anthropic Messages API request (same shape as what CLI sends)
      const anthropicReq: AnthropicRequest = {
        model: modelId,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      }

      // Transform to OpenAI format
      let transformedBody: unknown
      if (format === 'openai_chat') {
        transformedBody = anthropicToOpenaiChat(anthropicReq)
      } else {
        transformedBody = anthropicToOpenaiResponses(anthropicReq)
      }
      const upstreamUrl = resolveProviderUpstreamUrl(base, format)
      const proxyOptions = getProxyFetchOptions({ proxyUrl: getManualNetworkProxyUrl(networkSettings) })

      // Call upstream with transformed request
      const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(transformedBody),
        signal: AbortSignal.timeout(networkSettings.aiRequestTimeoutMs),
        ...proxyOptions,
      })

      if (!response.ok) {
        const latencyMs = Date.now() - start
        const errText = await response.text().catch(() => '')
        return { success: false, latencyMs, modelUsed: modelId, httpStatus: response.status,
          error: `Upstream HTTP ${response.status}: ${errText.slice(0, 200)}` }
      }

      // Transform response back to Anthropic format
      const responseBody = await response.json()
      const anthropicRes = format === 'openai_chat'
        ? openaiChatToAnthropic(responseBody, modelId)
        : openaiResponsesToAnthropic(responseBody, modelId)

      const latencyMs = Date.now() - start

      // Validate the final Anthropic response
      if (anthropicRes.type !== 'message' || !Array.isArray(anthropicRes.content)) {
        return { success: false, latencyMs, modelUsed: modelId,
          error: 'Proxy transform produced invalid Anthropic response' }
      }

      return { success: true, latencyMs, modelUsed: anthropicRes.model || modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: `Proxy pipeline timed out (${Math.round(networkSettings.aiRequestTimeoutMs / 1000)}s)`, modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function buildDirectTestRequest(
  base: string,
  apiKey: string,
  modelId: string,
  format: ApiFormat,
  authStrategy: ProviderAuthStrategy,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const prompt = 'Say "ok" and nothing else.'

  if (format === 'openai_chat') {
    return {
      url: resolveProviderUpstreamUrl(base, format),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
    }
  }
  if (format === 'openai_responses') {
    return {
      url: resolveProviderUpstreamUrl(base, format),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_output_tokens: 16, input: [{ type: 'message', role: 'user', content: prompt }] },
    }
  }
  // anthropic
  return {
    url: resolveProviderUpstreamUrl(base, format),
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...buildAnthropicAuthHeaders(apiKey, authStrategy),
    },
    body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
  }
}

function buildAnthropicAuthHeaders(apiKey: string, authStrategy: ProviderAuthStrategy): Record<string, string> {
  switch (authStrategy) {
    case 'api_key':
      return { 'x-api-key': apiKey }
    case 'auth_token':
    case 'auth_token_empty_api_key':
      return { Authorization: `Bearer ${apiKey}` }
    case 'dual_same_token':
      return { 'x-api-key': apiKey, Authorization: `Bearer ${apiKey}` }
    case 'dual_dummy':
      return { 'x-api-key': 'dummy', Authorization: 'Bearer dummy' }
  }
}

function validateResponseBody(
  body: Record<string, unknown> | null,
  format: ApiFormat,
): { ok: true; model?: string } | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Empty response — not a valid API endpoint' }
  if (body.error && typeof body.error === 'object') {
    return { ok: false, error: ((body.error as Record<string, unknown>).message as string) || 'Error in response body' }
  }

  if (format === 'openai_chat') {
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      return { ok: false, error: 'Response missing choices — not a valid Chat Completions endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  if (format === 'openai_responses') {
    if (!Array.isArray(body.output)) {
      return { ok: false, error: 'Response missing output — not a valid Responses API endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  // anthropic
  if (body.type !== 'message' || !Array.isArray(body.content)) {
    return { ok: false, error: 'Not a valid Anthropic Messages endpoint' }
  }
  return { ok: true, model: (body.model as string) || undefined }
}
