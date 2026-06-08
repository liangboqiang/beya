import { localCliRuntimeService } from '../services/localCliRuntimeService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

export async function handleLocalCliApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2]

    switch (sub) {
      case undefined:
        if (req.method !== 'GET') throw methodNotAllowed(req.method)
        return Response.json(await localCliRuntimeService.listLocalClis())

      case 'rescan':
        if (req.method !== 'POST') throw methodNotAllowed(req.method)
        return Response.json(await localCliRuntimeService.listLocalClis())

      case 'active':
        if (req.method !== 'PUT') throw methodNotAllowed(req.method)
        return Response.json(await handleActivate(req))

      case 'config':
        if (req.method !== 'PUT') throw methodNotAllowed(req.method)
        return Response.json(await handleUpdateConfig(req))

      case 'test':
        if (req.method !== 'POST') throw methodNotAllowed(req.method)
        return Response.json({ result: await handleTest(req) })

      default:
        throw ApiError.notFound(`Unknown local CLI endpoint: ${sub}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleActivate(req: Request): Promise<unknown> {
  const body = await parseJsonBody(req)
  const id = body.id
  if (id !== null && typeof id !== 'string') {
    throw ApiError.badRequest('Missing or invalid "id" in request body')
  }
  return localCliRuntimeService.activateLocalCli(id)
}

async function handleUpdateConfig(req: Request): Promise<unknown> {
  const body = await parseJsonBody(req)
  const id = body.id
  const config = body.config ?? body.env
  if (typeof id !== 'string' || !id.trim()) {
    throw ApiError.badRequest('Missing or invalid "id" in request body')
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw ApiError.badRequest('Missing or invalid "config" in request body')
  }
  return localCliRuntimeService.updateLocalCliConfig(
    id.trim(),
    config as Record<string, unknown>,
  )
}

async function handleTest(req: Request): Promise<unknown> {
  const body = await parseJsonBody(req)
  const id = body.id
  if (typeof id !== 'string' || !id.trim()) {
    throw ApiError.badRequest('Missing or invalid "id" in request body')
  }
  return localCliRuntimeService.testLocalCli(id.trim())
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
