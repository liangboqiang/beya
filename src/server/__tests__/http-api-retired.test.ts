import { afterEach, describe, expect, it } from 'bun:test'
import { startServer } from '../index.js'

let server: ReturnType<typeof startServer> | null = null

afterEach(() => {
  server?.stop(true)
  server = null
})

describe('retired HTTP API gateway', () => {
  it('does not expose HTTP /api resources', async () => {
    const port = 39_000 + Math.floor(Math.random() * 1_000)
    server = startServer(port, '127.0.0.1')
    const baseUrl = `http://127.0.0.1:${port}`

    const oldApi = await fetch(`${baseUrl}/api/health`)
    expect(oldApi.status).toBe(404)

    const health = await fetch(`${baseUrl}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      status: 'ok',
      service: 'beya-server',
    })

    const browserHealth = await fetch(`${baseUrl}/health`, {
      headers: {
        Origin: 'http://127.0.0.1:5173',
      },
    })
    expect(browserHealth.status).toBe(200)
    expect(browserHealth.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:5173')
  })
})
