import { checkOpus1mAccess, checkSonnet1mAccess } from './check1mAccess.js'
import { getUserSpecifiedModelSetting } from './model.js'
import { normalizeModelAlias } from './aliases.js'

// @[MODEL LAUNCH]: Add a branch for the new model if it supports a 1M context upgrade path.
/**
 * Get available model upgrade for more context
 * Returns null if no upgrade available or user already has max context
 */
function getAvailableUpgrade(): {
  alias: string
  name: string
  multiplier: number
} | null {
  const currentModelSetting = getUserSpecifiedModelSetting()
  const normalizedSetting =
    currentModelSetting === undefined || currentModelSetting === null
      ? currentModelSetting
      : normalizeModelAlias(currentModelSetting)
  if (normalizedSetting === 'powerful' && checkOpus1mAccess()) {
    return {
      alias: 'powerful[1m]',
      name: 'Powerful model 1M',
      multiplier: 5,
    }
  } else if (normalizedSetting === 'balanced' && checkSonnet1mAccess()) {
    return {
      alias: 'balanced[1m]',
      name: 'Balanced model 1M',
      multiplier: 5,
    }
  }

  return null
}

/**
 * Get upgrade message for different contexts
 */
export function getUpgradeMessage(context: 'warning' | 'tip'): string | null {
  const upgrade = getAvailableUpgrade()
  if (!upgrade) return null

  switch (context) {
    case 'warning':
      return `/model ${upgrade.alias}`
    case 'tip':
      return `Tip: You have access to ${upgrade.name} with ${upgrade.multiplier}x more context`
    default:
      return null
  }
}
