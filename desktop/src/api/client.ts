import { sendAppRpcRequest } from './appRpc'
import {
  getAuthToken,
  getBaseUrl,
  getDefaultBaseUrl,
  getHttpUrl,
  hasExplicitDefaultBaseUrl,
  setAuthToken,
  setBaseUrl,
} from './clientState'

const DIAGNOSTICS_PATH = '/diagnostics/events'

function getErrorMessage(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message
  }

  if (typeof body === 'string' && body.trim().length > 0) {
    return body
  }

  return `API error ${status}`
}

export function getApiUrl(pathOrUrl: string) {
  return getHttpUrl(pathOrUrl)
}

export {
  getAuthToken,
  getBaseUrl,
  getDefaultBaseUrl,
  hasExplicitDefaultBaseUrl,
  setAuthToken,
  setBaseUrl,
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(getErrorMessage(status, body))
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown, options?: { timeout?: number }): Promise<T> {
  const headers = buildHeaders()
  const timeoutMs = options?.timeout ?? 30_000

  try {
    const res = await sendAppRpcRequest({
      method,
      path: normalizeResourcePath(path),
      headers,
      body,
      timeoutMs,
    })

    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(res.status, res.body)
    }

    if (res.status === 204) return undefined as T
    return res.body as T
  } catch (err) {
    reportApiFailure(method, path, err)
    throw err
  }
}

function normalizeResourcePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

function reportApiFailure(method: string, path: string, error: unknown) {
  if (path.startsWith('/diagnostics')) return

  const details: Record<string, unknown> = {
    method,
    path,
    errorName: error instanceof Error ? error.name : typeof error,
    message: sanitizeDiagnosticValue(error instanceof Error ? error.message : String(error)),
  }

  if (error instanceof ApiError) {
    details.status = error.status
    details.response = sanitizeDiagnosticValue(error.body)
  }

  void rawRecordDiagnosticEvent({
    type: 'client_resource_request_failed',
    severity: 'warn',
    summary: `${method} ${path} failed: ${details.message}`,
    details,
  })
}

export function rawRecordDiagnosticEvent(event: {
  type: string
  severity?: 'debug' | 'info' | 'warn' | 'error'
  summary: string
  sessionId?: string
  details?: unknown
}) {
  return sendAppRpcRequest({
    method: 'POST',
    path: DIAGNOSTICS_PATH,
    headers: buildHeaders(),
    body: event,
    timeoutMs: 5_000,
  }).catch(() => undefined)
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = getAuthToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

function sanitizeDiagnosticValue(value: unknown): unknown {
  const token = getAuthToken()
  if (!token) return value

  if (typeof value === 'string') {
    return value.split(token).join('[redacted]')
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticValue(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeDiagnosticValue(entry)]),
    )
  }

  return value
}

export const api = {
  get: <T>(path: string, options?: { timeout?: number }) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: { timeout?: number }) => request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
