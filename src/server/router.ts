/**
 * Internal Beya resource router.
 *
 * Public clients enter through /rpc resource RPC. Resource paths are canonical
 * paths such as /sessions, /settings/user, and /tools. Dispatch is generated
 * from contracts/resources/v1/resources.yaml so production routing cannot drift
 * from the contract registry.
 */

import {
  dispatchGeneratedResourceRequest,
  type GeneratedResourceRequestOptions,
} from '../generated/modules/resourceHandlers.js'
import { errorResponse } from './middleware/errorHandler.js'
import type { handleFilesystemRoute } from './api/filesystem.js'

type ResourceRequestOptions = {
  filesystem?: Parameters<typeof handleFilesystemRoute>[3]
}

export async function handleResourceRequest(
  req: Request,
  url: URL,
  options: ResourceRequestOptions = {},
): Promise<Response> {
  try {
    const firstSegment = url.pathname.split('/').filter(Boolean)[0]
    if (!firstSegment || firstSegment === 'api') {
      return Response.json(
        { error: 'Not Found', message: `Unknown resource path: ${url.pathname}` },
        { status: 404 },
      )
    }

    return await dispatchGeneratedResourceRequest(
      req,
      url,
      options as GeneratedResourceRequestOptions,
    )
  } catch (error) {
    return errorResponse(error)
  }
}
