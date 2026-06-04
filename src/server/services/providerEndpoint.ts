import type { ApiFormat } from '../types/provider.js'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function stripEndpointPath(pathname: string, apiFormat: ApiFormat): string {
  let path = pathname.replace(/\/+$/, '')
  if (!path || path === '/') return ''

  if (apiFormat === 'anthropic') {
    path = path.replace(/\/v1\/messages$/i, '')
    path = path.replace(/\/messages$/i, '')
    return path === '/' ? '' : path
  }

  path = path.replace(/\/v1\/chat\/completions$/i, '/v1')
  path = path.replace(/\/chat\/completions$/i, '')
  path = path.replace(/\/v1\/responses$/i, '/v1')
  path = path.replace(/\/responses$/i, '')
  return path === '/' ? '' : path
}

export function normalizeProviderBaseUrl(baseUrl: string, apiFormat: ApiFormat): string {
  const trimmed = trimTrailingSlash(baseUrl.trim())
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    const normalizedPath = stripEndpointPath(url.pathname, apiFormat)
    url.pathname = normalizedPath || ''
    url.hash = ''
    return trimTrailingSlash(url.toString())
  } catch {
    return trimmed
  }
}

function appendPath(baseUrl: string, path: string): string {
  return `${trimTrailingSlash(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`
}

export function resolveProviderUpstreamUrl(baseUrl: string, apiFormat: ApiFormat): string {
  const normalized = normalizeProviderBaseUrl(baseUrl, apiFormat)
  if (apiFormat === 'anthropic') {
    return appendPath(normalized, '/v1/messages')
  }

  const openAIEndpoint = apiFormat === 'openai_responses'
    ? '/responses'
    : '/chat/completions'

  try {
    const url = new URL(normalized)
    const path = url.pathname.replace(/\/+$/, '')
    if (/\/v\d+$/i.test(path) || /\/compatible-mode\/v1$/i.test(path) || /\/openai(?:\/v\d+)?$/i.test(path)) {
      url.pathname = `${path}${openAIEndpoint}`
      return url.toString()
    }
  } catch {
    // Fall through to simple path append.
  }

  return appendPath(normalized, `/v1${openAIEndpoint}`)
}
