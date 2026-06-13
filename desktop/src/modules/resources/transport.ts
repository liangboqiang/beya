import { ApiError } from '../../api/client'
import { sendNamedAppRpcRequest } from '../../api/appRpc'
import type { RpcMethod, RpcResourceParams } from '../../../../src/generated/contracts'

export type ResourceTransportOptions = {
  timeout?: number
}

export async function sendNamedResourceRpc<T>(
  method: RpcMethod,
  params: RpcResourceParams = {},
  options: ResourceTransportOptions = {},
): Promise<T> {
  const res = await sendNamedAppRpcRequest({
    method,
    params,
    timeoutMs: options.timeout ?? 30_000,
  })

  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(res.status, res.body)
  }

  if (res.status === 204) return undefined as T
  return res.body as T
}
