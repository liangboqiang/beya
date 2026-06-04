import { ProviderService } from '../server/services/providerService.js'
import { SettingsService } from '../server/services/settingsService.js'
import { attributionHeaderEnvForModel } from '../server/services/attributionHeaderPolicy.js'
import {
  OPENAI_OFFICIAL_PROVIDER_ID,
  OPENAI_OFFICIAL_PROVIDER_NAME,
  isOpenAIOfficialProviderId,
} from '../server/services/openaiOfficialProvider.js'
import { OPENAI_CODEX_MODEL_CATALOG } from '../services/openaiAuth/models.js'
import { getProviderModels, type ModelDefinition } from '../server/config/providerCatalog.js'

export type GatewayModelInfo = {
  id: string
  name: string
  description: string
  context: string
  provider_id?: string
  tier?: string
  context_window?: number
  capabilities?: string[]
}

const providerService = new ProviderService()
const settingsService = new SettingsService()

export const gatewayModels = {
  async list(): Promise<{
    models: GatewayModelInfo[]
    provider: { id: string; name: string } | null
  }> {
    const { providers, activeId } = await providerService.listProviders()
    if (isOpenAIOfficialProviderId(activeId)) {
      return {
        models: buildOpenAIModelList(),
        provider: {
          id: OPENAI_OFFICIAL_PROVIDER_ID,
          name: OPENAI_OFFICIAL_PROVIDER_NAME,
        },
      }
    }

    const activeProvider = activeId
      ? providers.find(provider => provider.providerId === activeId)
      : null
    if (activeProvider) {
      return {
        models: buildProviderModelList(activeProvider),
        provider: {
          id: activeProvider.providerId,
          name: activeProvider.displayName,
        },
      }
    }

    return { models: getStandaloneModelList(), provider: null }
  },

  async current(): Promise<GatewayModelInfo> {
    const listed = await this.list()
    const { providers, activeId } = await providerService.listProviders()
    const openAIActive = isOpenAIOfficialProviderId(activeId)
    const activeProvider = activeId
      ? providers.find(provider => provider.providerId === activeId)
      : null
    const settings = activeProvider || openAIActive
      ? await providerService.getManagedSettings()
      : await settingsService.getUserSettings()
    const env = (settings.env as Record<string, string> | undefined) ?? {}
    const explicitModel = typeof settings.model === 'string' ? settings.model : ''
    const currentModel = explicitModel ||
      env.ANTHROPIC_MODEL ||
      activeProvider?.modelRoles.primary ||
      process.env.ANTHROPIC_MODEL?.trim() ||
      'claude-sonnet-4-6'

    return listed.models.find(model => model.id === currentModel) ?? {
      id: currentModel,
      name: currentModel,
      description: 'Current model',
      context: '',
    }
  },

  async set(modelId: string): Promise<void> {
    const colonIdx = modelId.indexOf(':')
    const baseId = colonIdx !== -1 ? modelId.slice(0, colonIdx) : modelId
    const contextTier =
      colonIdx !== -1 ? modelId.slice(colonIdx + 1) : undefined
    const updates: Record<string, unknown> = { model: baseId }
    updates.modelContext = contextTier

    const { activeId } = await providerService.listProviders()
    if (activeId) {
      const currentManagedSettings = await providerService.getManagedSettings()
      const currentEnv =
        (currentManagedSettings.env as Record<string, string> | undefined) ??
        {}
      await providerService.updateManagedSettings({
        ...updates,
        env: {
          ...currentEnv,
          ...attributionHeaderEnvForModel(baseId),
        },
      })
      return
    }

    await settingsService.updateUserSettings(updates)
  },

  resolve(model?: string): string {
    if (model?.trim()) return model.trim()
    return process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6'
  },
}

function buildOpenAIModelList(): GatewayModelInfo[] {
  return OPENAI_CODEX_MODEL_CATALOG.map(model => ({
    id: model.value,
    name: model.label,
    description: model.description,
    context: '',
  }))
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
}): GatewayModelInfo[] {
  const modelList: GatewayModelInfo[] = []
  const catalogModels = getProviderModels(provider.providerId)
  const enabled = new Set(provider.enabledModels?.length
    ? provider.enabledModels
    : Object.values(provider.modelRoles).filter(Boolean))

  for (const model of catalogModels) {
    if (enabled.size === 0 || enabled.has(model.id)) {
      addUniqueModel(modelList, modelDefinitionToGatewayModel(model))
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

function modelDefinitionToGatewayModel(model: ModelDefinition): GatewayModelInfo {
  return {
    id: model.id,
    name: model.displayName,
    description: `${model.tier} model`,
    context: model.contextWindow ? `${model.contextWindow}` : '',
    provider_id: model.providerId,
    tier: model.tier,
    context_window: model.contextWindow,
    capabilities: model.capabilities,
  }
}

function getStandaloneModelList(): GatewayModelInfo[] {
  const models = buildProviderModelList({
    providerId: 'env',
    enabledModels: [],
    modelRoles: {
      primary: process.env.ANTHROPIC_MODEL?.trim() || '',
      fast: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim() || '',
      balanced: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim() || '',
      powerful: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim() || '',
    },
  })
  return models.length > 0
    ? models
    : [
        {
          id: 'claude-sonnet-4-6',
          name: 'Sonnet 4.6',
          description: 'Default model',
          context: '200k',
        },
      ]
}

function addUniqueModel(models: GatewayModelInfo[], model: GatewayModelInfo | null): void {
  if (!model?.id.trim()) return
  if (models.some(existing => existing.id === model.id)) return
  models.push(model)
}
