import { afterEach, describe, expect, it, vi } from 'vitest'

const rpcMock = vi.hoisted(() => vi.fn())

vi.mock('./appRpc', () => ({
  sendAppRpcRequest: rpcMock,
}))

import { getDefaultBaseUrl, setBaseUrl } from './client'
import { openTargetsApi } from './openTargets'

describe('openTargetsApi', () => {
  afterEach(() => {
    setBaseUrl(getDefaultBaseUrl())
    rpcMock.mockReset()
    vi.restoreAllMocks()
  })

  it('normalizes relative icon URLs to the configured desktop server URL', async () => {
    rpcMock.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: {
        platform: 'darwin',
        targets: [
          {
            id: 'vscode',
            kind: 'ide',
            label: 'VS Code',
            icon: 'vscode',
            iconUrl: '/open-target-icons/vscode',
            platform: 'darwin',
          },
        ],
        primaryTargetId: 'vscode',
        cachedAt: 1,
        ttlMs: 30_000,
      },
    })

    setBaseUrl('http://127.0.0.1:49237')

    await expect(openTargetsApi.list()).resolves.toMatchObject({
      targets: [
        {
          id: 'vscode',
          iconUrl: 'http://127.0.0.1:49237/open-target-icons/vscode',
        },
      ],
    })
  })
})
