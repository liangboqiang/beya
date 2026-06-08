/**
 * Providers REST API
 *
 * GET    /api/providers              — list all saved providers + activeId
 * GET    /api/providers/catalog       — list provider and model catalog
 * GET    /api/providers/auth-status   — check whether any usable auth exists
 * GET    /api/providers/settings      — read Beya managed settings.json
 * POST   /api/providers              — add a provider
 * PUT    /api/providers/settings      — update Beya managed settings.json
 * PUT    /api/providers/:id          — update a provider
 * PATCH  /api/providers/:id          — update a provider
 * DELETE /api/providers/:id          — delete a provider
 * POST   /api/providers/:id/activate — activate a saved provider
 * POST   /api/providers/:id/test     — test a saved provider
 * POST   /api/providers/test         — test unsaved config
 */

import { z } from 'zod'
import { ProviderService } from '../services/providerService.js'
import { PROVIDER_CATALOG } from '../config/providerCatalog.js'
import {
  CreateProviderSchema,
  UpdateProviderSchema,
  TestProviderSchema,
  type SavedProvider,
} from '../types/provider.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { diagnosticsService } from '../services/diagnosticsService.js'

const providerService = new ProviderService()

export async function handleProvidersApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const id = segments[2]
    const action = segments[3]

    // POST /api/providers/test
    if (id === 'test' && req.method === 'POST') {
      return await handleTestUnsaved(req)
    }

    // POST /api/providers/rescan
    if (id === 'rescan' && req.method === 'POST') {
      const { providers, activeId } = await providerService.rescanProviders()
      return Response.json({ providers: providers.map(providerForApi), activeId })
    }

    // GET /api/providers/catalog
    if (id === 'catalog' && req.method === 'GET') {
      return Response.json({ catalog: PROVIDER_CATALOG })
    }

    // GET /api/providers/auth-status
    if (id === 'auth-status' && req.method === 'GET') {
      const status = await providerService.checkAuthStatus()
      return Response.json(status)
    }

    // /api/providers/settings
    if (id === 'settings') {
      if (req.method === 'GET') {
        return Response.json(redactSecretFields(await providerService.getManagedSettings()))
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody(req)
        await providerService.updateManagedSettings(body)
        return Response.json({ ok: true })
      }
      throw methodNotAllowed(req.method)
    }

    // /api/providers (no ID)
    if (!id) {
      if (req.method === 'GET') {
        const { providers, activeId } = await providerService.listProviders()
        return Response.json({ providers: providers.map(providerForApi), activeId })
      }
      if (req.method === 'POST') {
        return await handleCreate(req)
      }
      throw methodNotAllowed(req.method)
    }

    // /api/providers/:id/activate
    if (action === 'activate') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      await providerService.activateProvider(id)
      return Response.json({ ok: true })
    }

    // /api/providers/:id/test
    if (action === 'test') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      let overrides: { baseUrl?: string; modelId?: string; apiFormat?: string; authStrategy?: string } | undefined
      try {
        const body = await req.json()
        if (body && typeof body === 'object') overrides = body as typeof overrides
      } catch { /* no body is fine — uses saved values */ }
      const result = await providerService.testProvider(id, overrides)
      if (!result.connectivity.success || result.proxy?.success === false) {
        void diagnosticsService.recordEvent({
          type: 'provider_test_failed',
          severity: 'warn',
          summary: result.connectivity.error || result.proxy?.error || 'Provider test failed',
          details: {
            providerId: id,
            httpStatus: result.connectivity.httpStatus ?? result.proxy?.httpStatus,
            apiFormat: overrides?.apiFormat,
            modelId: overrides?.modelId,
            connectivity: result.connectivity,
            proxy: result.proxy,
          },
        })
      }
      return Response.json({ result })
    }

    // /api/providers/:id
    if (req.method === 'GET') {
      const provider = await providerService.getProvider(id)
      return Response.json({ provider: providerForApi(provider) })
    }
    if (req.method === 'PUT' || req.method === 'PATCH') {
      return await handleUpdate(req, id)
    }
    if (req.method === 'DELETE') {
      await providerService.deleteProvider(id)
      return Response.json({ ok: true })
    }

    throw methodNotAllowed(req.method)
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleCreate(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = CreateProviderSchema.parse(body)
    const provider = await providerService.addProvider(input)
    return Response.json({ provider: providerForApi(provider) }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function handleUpdate(req: Request, id: string): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = UpdateProviderSchema.parse(body)
    const provider = await providerService.updateProvider(id, input)
    return Response.json({ provider: providerForApi(provider) })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function handleTestUnsaved(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = TestProviderSchema.parse(body)
    const result = await providerService.testProviderConfig(input)
    if (!result.connectivity.success || result.proxy?.success === false) {
      void diagnosticsService.recordEvent({
        type: 'provider_test_failed',
        severity: 'warn',
        summary: result.connectivity.error || result.proxy?.error || 'Provider test failed',
        details: {
          providerId: null,
          baseUrl: input.baseUrl,
          apiFormat: input.apiFormat,
          modelId: input.modelId,
          connectivity: result.connectivity,
          proxy: result.proxy,
        },
      })
    }
    return Response.json({ result })
  } catch (err) {
    if (!(err instanceof z.ZodError)) {
      void diagnosticsService.recordEvent({
        type: 'provider_test_failed',
        severity: 'warn',
        summary: err instanceof Error ? err.message : String(err),
        details: { providerId: null, error: err },
      })
    }
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

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

function providerForApi(provider: SavedProvider): SavedProvider & { hasApiKey: boolean } {
  return {
    ...provider,
    apiKey: provider.apiKey ? '***REDACTED***' : '',
    hasApiKey: Boolean(provider.apiKey),
  }
}

function redactSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretFields)
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretField(key)) {
      out[key] = typeof item === 'string' && item ? '***REDACTED***' : item
    } else {
      out[key] = redactSecretFields(item)
    }
  }
  return out
}

function isSecretField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized.includes('apikey') ||
    normalized.includes('authtoken') ||
    normalized.includes('accesstoken') ||
    normalized.includes('refreshtoken') ||
    normalized.includes('clientsecret') ||
    normalized === 'token' ||
    normalized === 'secret' ||
    normalized === 'password'
}
