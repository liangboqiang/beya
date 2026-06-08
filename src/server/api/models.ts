/**
 * Models REST API
 *
 * GET  /api/models          — 获取可用模型列表
 * GET  /api/models/current  — 获取当前选中的模型
 * PUT  /api/models/current  — 切换模型
 * GET  /api/effort          — 获取 Effort 等级
 * PUT  /api/effort          — 设置 Effort 等级
 */

import { SettingsService } from '../services/settingsService.js'
import { ProviderService } from '../services/providerService.js'
import { attributionHeaderEnvForModel } from '../services/attributionHeaderPolicy.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { hasOpenAIAuthLogin } from '../../utils/auth.js'
import { OPENAI_CODEX_MODEL_CATALOG } from '../../services/openaiAuth/models.js'
import { getProviderModels, type ModelDefinition } from '../config/providerCatalog.js'

// Model catalogs come from the active provider, explicit env config, or OpenAI auth.

const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const

const DEFAULT_EFFORT = 'max'

const settingsService = new SettingsService()
const providerService = new ProviderService()

type ApiModelInfo = {
  id: string
  name: string
  description: string
  context: string
  providerId?: string
  tier?: string
  contextWindow?: number
  capabilities?: string[]
}

function addUniqueModel(
  models: ApiModelInfo[],
  model: ApiModelInfo | null,
): void {
  if (!model || !model.id.trim()) {
    return
  }

  if (models.some(existing => existing.id === model.id)) {
    return
  }

  models.push(model)
}

function modelDefinitionToApiModel(model: ModelDefinition): ApiModelInfo {
  return {
    id: model.id,
    name: model.displayName,
    description: `${model.tier} model`,
    context: model.contextWindow ? `${model.contextWindow}` : '',
    providerId: model.providerId,
    tier: model.tier,
    contextWindow: model.contextWindow,
    capabilities: model.capabilities,
  }
}

function buildProviderModelList(provider: {
  providerId: string
  modelRoles: {
    primary: string
    fast: string
    balanced: string
    powerful: string
  }
  enabledModels?: string[]
}): ApiModelInfo[] {
  const modelList: ApiModelInfo[] = []
  const catalogModels = getProviderModels(provider.providerId)
  const enabled = new Set(provider.enabledModels?.length
    ? provider.enabledModels
    : Object.values(provider.modelRoles).filter(Boolean))

  for (const model of catalogModels) {
    if (enabled.size === 0 || enabled.has(model.id)) {
      addUniqueModel(modelList, modelDefinitionToApiModel(model))
    }
  }

  addUniqueModel(modelList, {
    id: provider.modelRoles.primary,
    name: provider.modelRoles.primary,
    description: 'Primary model',
    context: '',
  })
  addUniqueModel(modelList, provider.modelRoles.fast
    ? {
        id: provider.modelRoles.fast,
        name: provider.modelRoles.fast,
        description: 'Fast model',
        context: '',
      }
    : null)
  addUniqueModel(modelList, provider.modelRoles.balanced
    ? {
        id: provider.modelRoles.balanced,
        name: provider.modelRoles.balanced,
        description: 'Balanced model',
        context: '',
      }
    : null)
  addUniqueModel(modelList, provider.modelRoles.powerful
    ? {
        id: provider.modelRoles.powerful,
        name: provider.modelRoles.powerful,
        description: 'Powerful model',
        context: '',
      }
    : null)

  return modelList
}

function buildOpenAIModelList(): ApiModelInfo[] {
  return OPENAI_CODEX_MODEL_CATALOG.map(model => ({
    id: model.value,
    name: model.label,
    description: model.description,
    context: '',
  }))
}

function getEnvConfiguredAnthropicModels(): ApiModelInfo[] {
  return buildProviderModelList({
    providerId: 'env',
    enabledModels: [],
    modelRoles: {
    primary: process.env.ANTHROPIC_MODEL?.trim() || '',
    fast: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim() || '',
    balanced: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim() || '',
    powerful: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim() || '',
    },
  })
}

function getOpenAIAuthModels(): ApiModelInfo[] {
  if (!hasOpenAIAuthLogin()) {
    return []
  }

  return buildOpenAIModelList()
}

function getStandaloneModelList(): ApiModelInfo[] {
  const models = [...getEnvConfiguredAnthropicModels()]

  for (const model of getOpenAIAuthModels()) {
    addUniqueModel(models, model)
  }

  return models
}

function normalizeEffortLevel(value: unknown): (typeof EFFORT_LEVELS)[number] {
  return typeof value === 'string' && EFFORT_LEVELS.includes(value as (typeof EFFORT_LEVELS)[number])
    ? value as (typeof EFFORT_LEVELS)[number]
    : DEFAULT_EFFORT
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleModelsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const resource = segments[1] // 'models' | 'effort'
    const sub = segments[2] // 'current' | undefined

    // ── /api/effort ───────────────────────────────────────────────────
    if (resource === 'effort') {
      return await handleEffort(req)
    }

    // ── /api/models/* ─────────────────────────────────────────────────
    switch (sub) {
      case undefined:
        // GET /api/models — 优先从激活的 Provider 读取模型列表
        if (req.method !== 'GET') throw methodNotAllowed(req.method)
        return await handleModelsList()

      case 'current':
        return await handleCurrentModel(req)

      default:
        throw ApiError.notFound(`Unknown models endpoint: ${sub}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleModelsList(): Promise<Response> {
  const { providers, activeId } = await providerService.listProviders()
  const activeProvider = activeId ? providers.find((p) => p.providerId === activeId) : null
  if (activeProvider) {
    const modelList = buildProviderModelList(activeProvider)
    return Response.json({
      models: modelList,
      provider: { id: activeProvider.providerId, name: activeProvider.displayName },
    })
  }
  return Response.json({ models: getStandaloneModelList(), provider: null })
}

async function handleCurrentModel(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    // Build the model list from the active provider, otherwise from explicit standalone config.
    const { providers, activeId } = await providerService.listProviders()
    const activeProvider = activeId ? providers.find((p) => p.providerId === activeId) : null
    const settings = activeProvider
      ? await providerService.getManagedSettings()
      : await settingsService.getUserSettings()
    const explicitModel = (settings.model as string) || ''
    const contextTier = (settings.modelContext as string) || undefined
    const env = (settings.env as Record<string, string>) || {}
    const envModel = process.env.ANTHROPIC_MODEL?.trim() || ''

    let currentModelId: string
    let currentModelName: string

    if (activeProvider) {
      // Provider is active — only use the provider-managed beya settings.
      // This avoids leaking global ~/.beya/settings.json model choices into
      // the active provider flow.
      const providerEnvModel = env.ANTHROPIC_MODEL
      if (providerEnvModel && !explicitModel) {
        currentModelId = providerEnvModel
        currentModelName = providerEnvModel
      } else {
        currentModelId = explicitModel || providerEnvModel || activeProvider.modelRoles.primary
        currentModelName = currentModelId
      }
    } else {
      // No provider — use settings model with context tier
      currentModelId = explicitModel || envModel
      currentModelName = currentModelId
    }

    const lookupId = contextTier ? `${currentModelId}:${contextTier}` : currentModelId

    // Build available models for name lookup
    const availableModels = activeProvider
      ? buildProviderModelList(activeProvider)
      : getStandaloneModelList()

    const modelEntry = availableModels.find((m) => m.id === lookupId)
      || availableModels.find((m) => m.id === currentModelId)
      || {
        id: currentModelId,
        name: currentModelName || 'No model configured',
        description: currentModelId ? 'Custom model' : 'No model configured',
        context: contextTier || 'unknown',
      }

    return Response.json({ model: { ...modelEntry, context: contextTier || modelEntry.context } })
  }

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req)
    const modelId = body.modelId
    if (typeof modelId !== 'string' || !modelId) {
      throw ApiError.badRequest('Missing or invalid "modelId" in request body')
    }

    // Parse composite IDs like 'provider-model-id:1m'.
    // Persist the base model ID for CLI compatibility and context tier separately
    const colonIdx = modelId.indexOf(':')
    const baseId = colonIdx !== -1 ? modelId.slice(0, colonIdx) : modelId
    const contextTier = colonIdx !== -1 ? modelId.slice(colonIdx + 1) : undefined

    const updates: Record<string, unknown> = { model: baseId }
    if (contextTier) {
      updates.modelContext = contextTier
    } else {
      // Clear context tier when switching to a non-composite model
      updates.modelContext = undefined
    }
    const { activeId } = await providerService.listProviders()
    if (activeId) {
      const currentManagedSettings = await providerService.getManagedSettings()
      const currentEnv =
        (currentManagedSettings.env as Record<string, string> | undefined) ?? {}
      await providerService.updateManagedSettings({
        ...updates,
        env: {
          ...currentEnv,
          ...attributionHeaderEnvForModel(baseId),
        },
      })
    } else {
      await settingsService.updateUserSettings(updates)
    }
    return Response.json({ ok: true, model: modelId })
  }

  throw methodNotAllowed(req.method)
}

async function handleEffort(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const settings = await settingsService.getUserSettings()
    const level = normalizeEffortLevel(settings.effort)
    return Response.json({ level, available: EFFORT_LEVELS })
  }

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req)
    const level = body.level
    if (typeof level !== 'string') {
      throw ApiError.badRequest('Missing or invalid "level" in request body')
    }
    if (!EFFORT_LEVELS.includes(level as (typeof EFFORT_LEVELS)[number])) {
      throw ApiError.badRequest(
        `Invalid effort level: "${level}". Valid levels: ${EFFORT_LEVELS.join(', ')}`,
      )
    }
    await settingsService.updateUserSettings({ effort: level })
    return Response.json({ ok: true, level })
  }

  throw methodNotAllowed(req.method)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
