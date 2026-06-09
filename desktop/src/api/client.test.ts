import { afterEach, describe, expect, it, vi } from 'vitest'

const rpcMock = vi.hoisted(() => vi.fn())

vi.mock('./appRpc', () => ({
  sendAppRpcRequest: rpcMock,
}))

import {
  api,
  getApiUrl,
  getDefaultBaseUrl,
  rawRecordDiagnosticEvent,
  setAuthToken,
  setBaseUrl,
} from './client'

describe('app resource client', () => {
  afterEach(() => {
    setAuthToken(null)
    setBaseUrl(getDefaultBaseUrl())
    rpcMock.mockReset()
    vi.restoreAllMocks()
  })

  it('sends resource requests through app WebSocket RPC without Authorization by default', async () => {
    rpcMock.mockResolvedValueOnce({ status: 200, headers: {}, body: { ok: true } })

    await api.get('/api/status')

    expect(rpcMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      path: '/status',
      headers: {
        'Content-Type': 'application/json',
      },
    }))
  })

  it('resolves relative asset URLs against the configured server base URL', () => {
    setBaseUrl('http://127.0.0.1:49237')

    expect(getApiUrl('/open-target-icons/finder')).toBe(
      'http://127.0.0.1:49237/open-target-icons/finder',
    )
    expect(getApiUrl('https://example.com/icon.png')).toBe('https://example.com/icon.png')
  })

  it('adds Authorization when an H5 token is configured', async () => {
    rpcMock.mockResolvedValueOnce({ status: 200, headers: {}, body: { ok: true } })

    setAuthToken('h5_x')
    await api.get('/api/status')

    expect(rpcMock).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer h5_x',
      }),
    }))
  })

  it('reports non-diagnostics resource failures without request bodies', async () => {
    rpcMock
      .mockResolvedValueOnce({ status: 500, headers: {}, body: { message: 'Nope' } })
      .mockResolvedValueOnce({ status: 200, headers: {}, body: { ok: true } })

    await expect(api.post('/api/providers/test', { apiKey: 'sk-should-not-report' })).rejects.toThrow('Nope')

    expect(rpcMock).toHaveBeenCalledTimes(2)
    const diagnosticCall = rpcMock.mock.calls[1]?.[0]
    expect(diagnosticCall.path).toBe('/diagnostics/events')
    const body = JSON.parse(String(diagnosticCall.body))
    expect(body.type).toBe('client_resource_request_failed')
    expect(body.details.path).toBe('/api/providers/test')
    expect(JSON.stringify(body)).not.toContain('sk-should-not-report')
  })

  it('does not leak the H5 token in diagnostics payloads', async () => {
    rpcMock
      .mockResolvedValueOnce({ status: 401, headers: {}, body: { message: 'Unauthorized' } })
      .mockResolvedValueOnce({ status: 200, headers: {}, body: { ok: true } })

    setAuthToken('h5_super_secret')

    await expect(api.get('/api/status')).rejects.toThrow('Unauthorized')

    const body = JSON.parse(String(rpcMock.mock.calls[1]?.[0].body))
    expect(JSON.stringify(body)).not.toContain('h5_super_secret')
  })

  it('does not recursively report diagnostics endpoint failures', async () => {
    rpcMock.mockResolvedValueOnce({ status: 500, headers: {}, body: { message: 'diagnostics down' } })

    await expect(api.get('/api/diagnostics/status')).rejects.toThrow('diagnostics down')

    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('can report raw client exceptions through app WebSocket RPC', async () => {
    rpcMock.mockResolvedValueOnce({ status: 200, headers: {}, body: { ok: true } })

    await rawRecordDiagnosticEvent({
      type: 'client_window_error',
      severity: 'error',
      summary: 'boom',
      details: { filename: 'App.tsx' },
    })

    expect(rpcMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(rpcMock.mock.calls[0]?.[0].body))
    expect(body.type).toBe('client_window_error')
  })
})
