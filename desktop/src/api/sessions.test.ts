import { afterEach, describe, expect, it, vi } from 'vitest'

const rpcMock = vi.hoisted(() => vi.fn())

vi.mock('./appRpc', () => ({
  sendAppRpcRequest: rpcMock,
}))

import { setBaseUrl } from './client'
import { sessionsApi } from './sessions'

describe('sessionsApi', () => {
  afterEach(() => {
    setBaseUrl('http://127.0.0.1:3456')
    rpcMock.mockReset()
    vi.restoreAllMocks()
  })

  it('posts branch requests to the session branch endpoint', async () => {
    rpcMock.mockResolvedValueOnce({
      status: 201,
      headers: {},
      body: {
        sessionId: 'branch-session',
        title: 'Branch',
        workDir: '/workspace/repo',
        sourceSessionId: 'source-session',
        targetMessageId: 'message-1',
      },
    })

    setBaseUrl('http://127.0.0.1:49237')
    const result = await sessionsApi.branch('source-session', {
      targetMessageId: 'message-1',
      title: 'Branch',
    })

    expect(result.sessionId).toBe('branch-session')
    expect(rpcMock).toHaveBeenCalledOnce()
    expect(rpcMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/sessions/source-session/branch',
      body: {
        targetMessageId: 'message-1',
        title: 'Branch',
      },
    }))
  })
})
