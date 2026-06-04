import { describe, expect, it } from 'vitest'

const productionModules = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const EXCLUDED_PARTS = new Set([
  '__tests__',
  'i18n',
  'mocks',
])

const EXCLUDED_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.d.ts',
]

const BRANDED_MODEL_ROLE_EXCLUDED_PARTS = new Set([
  '__tests__',
  'i18n',
])

const BLOCKED_VISIBLE_PHRASES = [
  'Open composer tools',
  'Connect to H5 Access',
  'Rendering diagram...',
  'Generating diagram...',
  'Mermaid Error',
  'Zoom out',
  'Zoom in',
  'Fit diagram',
  'Previous image',
  'Next image',
  'Close dialog',
  'Minimize window',
  'Maximize window',
  'Close window',
  'Failed to check status.',
  'WeChat bind failed',
  'WeChat QR URL missing',
  'Save failed',
  'Invalid JSON',
  'Unable to reach',
  'Unable to verify the H5 access token.',
  'The saved H5 token is no longer valid.',
  'Copy reply',
  'Copy prompt',
]

const BLOCKED_BRANDED_MODEL_ROLES = [
  'Ha' + 'iku',
  'Son' + 'net',
  'Op' + 'us',
]

function isProductionSourcePath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized.startsWith('../')) return false
  const parts = normalized.split('/')
  if (parts.some((part) => EXCLUDED_PARTS.has(part))) return false
  return !EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

function isDesktopRoleSourcePath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized.startsWith('../')) return false
  const parts = normalized.split('/')
  if (parts.some((part) => BRANDED_MODEL_ROLE_EXCLUDED_PARTS.has(part))) return false
  return !EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

describe('hardcoded visible English scanner', () => {
  it('keeps fixed Chinese-locale UI phrases behind i18n keys', () => {
    const matches: string[] = []

    for (const [path, content] of Object.entries(productionModules)) {
      if (!isProductionSourcePath(path)) continue
      for (const phrase of BLOCKED_VISIBLE_PHRASES) {
        if (content.includes(phrase)) {
          matches.push(`${path}: ${phrase}`)
        }
      }
    }

    expect(matches).toEqual([])
  })

  it('keeps branded model family names out of desktop UI role labels', () => {
    const matches: string[] = []

    for (const [path, content] of Object.entries(productionModules)) {
      if (!isDesktopRoleSourcePath(path)) continue
      for (const roleName of BLOCKED_BRANDED_MODEL_ROLES) {
        if (content.includes(roleName)) {
          matches.push(`${path}: ${roleName}`)
        }
      }
    }

    expect(matches).toEqual([])
  })
})
