export const MODEL_ALIASES = [
  'balanced',
  'powerful',
  'fast',
  'sonnet',
  'opus',
  'haiku',
  'best',
  'balanced[1m]',
  'powerful[1m]',
  'sonnet[1m]',
  'opus[1m]',
  'powerful-plan',
  'opusplan',
] as const
export type ModelAlias = (typeof MODEL_ALIASES)[number]

export function isModelAlias(modelInput: string): modelInput is ModelAlias {
  return MODEL_ALIASES.includes(modelInput as ModelAlias)
}

export function normalizeModelAlias(modelInput: string): string {
  switch (modelInput.toLowerCase()) {
    case 'sonnet':
      return 'balanced'
    case 'opus':
      return 'powerful'
    case 'haiku':
      return 'fast'
    case 'sonnet[1m]':
      return 'balanced[1m]'
    case 'opus[1m]':
      return 'powerful[1m]'
    case 'opusplan':
      return 'powerful-plan'
    default:
      return modelInput.toLowerCase()
  }
}

/**
 * Bare model family aliases that act as wildcards in the availableModels allowlist.
 * When "powerful" is in the allowlist, any powerful model is allowed.
 * When a specific model ID is in the allowlist, only that exact version is allowed.
 */
export const MODEL_FAMILY_ALIASES = [
  'balanced',
  'powerful',
  'fast',
  'sonnet',
  'opus',
  'haiku',
] as const

export function isModelFamilyAlias(model: string): boolean {
  return (MODEL_FAMILY_ALIASES as readonly string[]).includes(
    normalizeModelAlias(model),
  )
}
