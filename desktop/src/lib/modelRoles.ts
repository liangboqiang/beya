import type { ModelRoles, SavedProvider } from '../types/provider'
import type { ProviderDefinition } from '../types/providerCatalog'

export const EMPTY_MODEL_ROLES: ModelRoles = {
  primary: '',
  fast: '',
  balanced: '',
  powerful: '',
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

export function getProviderModelRoles(provider: SavedProvider): ModelRoles {
  return normalizeModelRoles(provider.modelRoles)
}

export function getDefinitionModelRoles(provider: ProviderDefinition): ModelRoles {
  return normalizeModelRoles(provider.defaultModelRoles)
}
