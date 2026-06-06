import type { TranslationKey } from '../i18n'
import type { ThemeMode } from '../types/settings'

export type ThemeOption = {
  value: ThemeMode
  categoryKey: TranslationKey
  labelKey: TranslationKey
  descriptionKey: TranslationKey
  swatches: readonly [string, string, string]
  colorScheme: 'light' | 'dark'
}

export const DEFAULT_THEME: ThemeMode = 'opendesign'

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    value: 'opendesign',
    categoryKey: 'settings.general.themeCategory.project',
    labelKey: 'settings.general.appearance.opendesign',
    descriptionKey: 'settings.general.appearance.opendesignDescription',
    swatches: ['#f7f6fb', '#ffffff', '#6c5ce7'],
    colorScheme: 'light',
  },
  {
    value: 'white',
    categoryKey: 'settings.general.themeCategory.light',
    labelKey: 'settings.general.appearance.white',
    descriptionKey: 'settings.general.appearance.whiteDescription',
    swatches: ['#ffffff', '#f6f8fa', '#8f482f'],
    colorScheme: 'light',
  },
  {
    value: 'light',
    categoryKey: 'settings.general.themeCategory.light',
    labelKey: 'settings.general.appearance.light',
    descriptionKey: 'settings.general.appearance.lightDescription',
    swatches: ['#fbfaf6', '#f4f2ed', '#8f482f'],
    colorScheme: 'light',
  },
  {
    value: 'graphite',
    categoryKey: 'settings.general.themeCategory.utility',
    labelKey: 'settings.general.appearance.graphite',
    descriptionKey: 'settings.general.appearance.graphiteDescription',
    swatches: ['#f5f6f8', '#ffffff', '#2563eb'],
    colorScheme: 'light',
  },
  {
    value: 'forest',
    categoryKey: 'settings.general.themeCategory.utility',
    labelKey: 'settings.general.appearance.forest',
    descriptionKey: 'settings.general.appearance.forestDescription',
    swatches: ['#f6faf8', '#ffffff', '#0f766e'],
    colorScheme: 'light',
  },
  {
    value: 'dark',
    categoryKey: 'settings.general.themeCategory.dark',
    labelKey: 'settings.general.appearance.dark',
    descriptionKey: 'settings.general.appearance.darkDescription',
    swatches: ['#131313', '#201f1f', '#ffb59f'],
    colorScheme: 'dark',
  },
  {
    value: 'midnight',
    categoryKey: 'settings.general.themeCategory.dark',
    labelKey: 'settings.general.appearance.midnight',
    descriptionKey: 'settings.general.appearance.midnightDescription',
    swatches: ['#0d1220', '#151b2e', '#7dd3fc'],
    colorScheme: 'dark',
  },
] as const

export function isDarkThemeMode(theme: ThemeMode): boolean {
  return THEME_OPTIONS.some((option) => option.value === theme && option.colorScheme === 'dark')
}
