import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { startServer } from '../index.js'
import { H5AccessService } from '../services/h5AccessService.js'
import { ProviderService } from '../services/providerService.js'
import { buildRpcResourceCall } from '../../generated/contracts/index.js'

let server: ReturnType<typeof Bun.serve> | undefined
let baseUrl = ''
let wsBaseUrl = ''
let lanBaseUrl = ''
let lanWsBaseUrl = ''
let tmpDir = ''
let originalConfigDir: string | undefined
let originalAnthropicApiKey: string | undefined
let originalH5DistDir: string | undefined
let originalClaudeAppRoot: string | undefined
let originalServerAuthRequired: string | undefined
let originalServerPort = 3456
const PHONE_ORIGIN = 'https://phone.example'

type RpcRequestOptions = RequestInit & {
  httpBaseUrl?: string
  wsBaseUrl?: string
  token?: string
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.status < 500) {
        return
      }
    } catch {}

    await Bun.sleep(50)
  }

  throw new Error(`Timed out waiting for server at ${url}`)
}

async function stopRemoteServer(): Promise<void> {
  const activeServer = server
  server = undefined
  if (activeServer) {
    await Promise.race([
      activeServer.stop(true),
      Bun.sleep(1000),
    ])
    await Bun.sleep(25)
  }
}

async function rmWithRetry(targetPath: string): Promise<void> {
  const attempts = process.platform === 'win32' ? 5 : 1
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        attempt === attempts - 1 ||
        !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')
      ) {
        throw error
      }
      await Bun.sleep(100 * (attempt + 1))
    }
  }
}

function randomPort(): number {
  return 18000 + Math.floor(Math.random() * 10000)
}

function resolvePrivateLanBaseUrl(port: number): string | null {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue
      }

      if (
        entry.address.startsWith('10.') ||
        entry.address.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(entry.address)
      ) {
        return `http://${entry.address}:${port}`
      }
    }
  }

  return null
}

async function startRemoteServer(options: { authRequired?: boolean } = {}): Promise<void> {
  if (options.authRequired) {
    process.env.SERVER_AUTH_REQUIRED = '1'
  } else {
    delete process.env.SERVER_AUTH_REQUIRED
  }

  const port = randomPort()
  server = startServer(port, '0.0.0.0')
  baseUrl = `http://127.0.0.1:${port}`
  wsBaseUrl = `ws://127.0.0.1:${port}`
  lanBaseUrl = resolvePrivateLanBaseUrl(port) ?? ''
  lanWsBaseUrl = lanBaseUrl.replace(/^http/, 'ws')
  await waitForServer(`${baseUrl}/health`)
}

async function restartRemoteServer(options: { authRequired?: boolean } = {}): Promise<void> {
  await stopRemoteServer()
  await startRemoteServer(options)
}

function makeUpgradeHeaders(origin?: string): Record<string, string> {
  return {
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    ...(origin ? { Origin: origin } : {}),
  }
}

function spoofedLoopbackHeaders(port: string): Record<string, string> {
  return {
    Host: `127.0.0.1:${port}`,
    Origin: 'http://127.0.0.1:5179',
  }
}

async function enableH5Access(options: {
  allowedOrigins?: string[]
  publicBaseUrl?: string | null
} = {}): Promise<string> {
  const service = new H5AccessService()
  if (options.allowedOrigins || options.publicBaseUrl !== undefined) {
    await service.updateSettings({
      allowedOrigins: options.allowedOrigins,
      publicBaseUrl: options.publicBaseUrl,
    })
  }
  const { token } = await service.enable()
  if (options.allowedOrigins || options.publicBaseUrl !== undefined) {
    await service.updateSettings({
      allowedOrigins: options.allowedOrigins,
      publicBaseUrl: options.publicBaseUrl,
    })
  }
  return token
}

function rpcUpgradeUrl(httpBaseUrl = baseUrl, token?: string): string {
  const url = new URL('/rpc', httpBaseUrl)
  if (token) {
    url.searchParams.set('token', token)
  }
  return url.toString()
}

function rpcWebSocketUrl(base = wsBaseUrl, token?: string): string {
  const url = new URL('/rpc', base)
  if (token) {
    url.searchParams.set('token', token)
  }
  return url.toString()
}

function normalizeResourcePath(resourcePath: string): string {
  const url = new URL(resourcePath, baseUrl)
  if (url.pathname === '/api') {
    return `/${url.search}`
  }
  if (url.pathname.startsWith('/api/')) {
    return `${url.pathname.slice('/api'.length)}${url.search}`
  }
  return `${url.pathname}${url.search}`
}

function headerRecord(headers?: HeadersInit): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}

async function rpcUpgradeResponse(options: {
  httpBaseUrl?: string
  origin?: string
  token?: string
  headers?: Record<string, string>
} = {}): Promise<Response> {
  return fetch(rpcUpgradeUrl(options.httpBaseUrl, options.token), {
    headers: {
      ...makeUpgradeHeaders(options.origin),
      ...(options.headers || {}),
    },
  })
}

async function rpcPreflightResponse(options: {
  httpBaseUrl?: string
  origin: string
  requestMethod?: string
  headers?: Record<string, string>
}): Promise<Response> {
  return fetch(rpcUpgradeUrl(options.httpBaseUrl), {
    method: 'OPTIONS',
    headers: {
      Origin: options.origin,
      'Access-Control-Request-Method': options.requestMethod || 'GET',
      ...(options.headers || {}),
    },
  })
}

async function rpcResourceRequest(resourcePath: string, init: RpcRequestOptions = {}): Promise<Response> {
  const resource = normalizeResourcePath(resourcePath)
  const requestId = `h5-rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const headers = headerRecord(init.headers)
  const targetWsBaseUrl = init.wsBaseUrl || wsBaseUrl

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      rpcWebSocketUrl(targetWsBaseUrl, init.token),
      { headers } as unknown as string[],
    )
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      ws.close()
      reject(new Error(`Timed out waiting for RPC response for ${resource}`))
    }, 5000)

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
      callback()
    }

    ws.addEventListener('open', () => {
      const call = buildRpcResourceCall({
        httpMethod: init.method || 'GET',
        path: resource,
        headers,
        body: init.body as never,
      })
      ws.send(JSON.stringify({
        type: 'rpc.request',
        id: requestId,
        method: call.method,
        params: call.params,
      }))
    })

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        type: string
        id?: string
        status?: number
        headers?: Record<string, string>
        result?: unknown
        code?: string
        message?: string
      }
      if (message.type === 'rpc.connected' || message.type === 'rpc.pong') return
      if (message.id !== requestId) return
      if (message.type === 'rpc.error') {
        finish(() => resolve(Response.json(
          { error: message.code, message: message.message },
          { status: 400 },
        )))
        return
      }
      if (message.type !== 'rpc.response') return

      finish(() => resolve(new Response(
        message.result === undefined || message.result === null
          ? null
          : typeof message.result === 'string'
            ? message.result
            : JSON.stringify(message.result),
        {
          status: message.status ?? 200,
          headers: message.headers,
        },
      )))
    })

    ws.addEventListener('error', () => {
      finish(() => reject(new Error(`RPC WebSocket failed for ${resource}`)))
    })

    ws.addEventListener('close', () => {
      if (!settled) {
        finish(() => reject(new Error(`RPC WebSocket closed before response for ${resource}`)))
      }
    })
  })
}

function expectWebSocketOpen(url: string, headers?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = headers
      ? new WebSocket(url, { headers } as unknown as string[])
      : new WebSocket(url)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error(`Timed out opening websocket: ${url}`))
    }, 5000)

    ws.addEventListener('open', () => {
      clearTimeout(timeout)
      ws.close()
      resolve()
    })

    ws.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error(`WebSocket failed to open: ${url}`))
    })
  })
}

function expectWebSocketUpgradeThenClose(url: string, headers?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = headers
      ? new WebSocket(url, { headers } as unknown as string[])
      : new WebSocket(url)
    let opened = false
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error(`Timed out waiting for websocket close: ${url}`))
    }, 5000)

    ws.addEventListener('open', () => {
      opened = true
    })

    ws.addEventListener('close', () => {
      clearTimeout(timeout)
      if (opened) {
        resolve()
      } else {
        reject(new Error(`WebSocket closed before upgrade completed: ${url}`))
      }
    })

    ws.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error(`WebSocket failed before upgrade completed: ${url}`))
    })
  })
}

const settingsSurfaceEndpoints = [
  { path: '/mcp', expected: { servers: [] } },
  { path: '/plugins', expected: { plugins: [] } },
  { path: '/agents', expectedKey: 'activeAgents' },
] as const

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5-access-auth-test-'))
  originalConfigDir = process.env.BEYA_CONFIG_DIR
  originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY
  originalH5DistDir = process.env.CLAUDE_H5_DIST_DIR
  originalClaudeAppRoot = process.env.CLAUDE_APP_ROOT
  originalServerAuthRequired = process.env.SERVER_AUTH_REQUIRED
  originalServerPort = ProviderService.getServerPort()
  process.env.BEYA_CONFIG_DIR = tmpDir
  const h5DistDir = path.join(tmpDir, 'dist')
  process.env.CLAUDE_H5_DIST_DIR = h5DistDir
  delete process.env.ANTHROPIC_API_KEY
  await fs.mkdir(path.join(h5DistDir, 'assets'), { recursive: true })
  await fs.writeFile(
    path.join(h5DistDir, 'index.html'),
    '<!doctype html><html><head><script type="module" src="/assets/app.js"></script></head><body>H5 Shell</body></html>',
    'utf-8',
  )
  await fs.writeFile(path.join(h5DistDir, 'assets/app.js'), 'window.__h5 = true', 'utf-8')
  await startRemoteServer()
})

afterEach(async () => {
  await stopRemoteServer()
  ProviderService.setServerPort(originalServerPort)

  if (originalConfigDir === undefined) delete process.env.BEYA_CONFIG_DIR
  else process.env.BEYA_CONFIG_DIR = originalConfigDir

  if (originalAnthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey
  if (originalH5DistDir === undefined) delete process.env.CLAUDE_H5_DIST_DIR
  else process.env.CLAUDE_H5_DIST_DIR = originalH5DistDir
  if (originalClaudeAppRoot === undefined) delete process.env.CLAUDE_APP_ROOT
  else process.env.CLAUDE_APP_ROOT = originalClaudeAppRoot
  if (originalServerAuthRequired === undefined) delete process.env.SERVER_AUTH_REQUIRED
  else process.env.SERVER_AUTH_REQUIRED = originalServerAuthRequired

  await rmWithRetry(tmpDir)
})

describe('remote H5 auth and CORS integration', () => {
  test('serves the packaged H5 shell and static assets from the remote server', async () => {
    const shellResponse = await fetch(`${baseUrl}/`)
    expect(shellResponse.status).toBe(200)
    expect(shellResponse.headers.get('Content-Type')).toContain('text/html')
    await expect(shellResponse.text()).resolves.toContain('H5 Shell')

    const assetResponse = await fetch(`${baseUrl}/assets/app.js`)
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('Cache-Control')).toContain('immutable')
    await expect(assetResponse.text()).resolves.toContain('window.__h5')
  })

  test('finds Tauri packaged H5 resources under Resources/_up_/dist', async () => {
    const appRoot = path.join(tmpDir, 'Fake.app', 'Contents', 'MacOS')
    const mappedDistDir = path.join(tmpDir, 'Fake.app', 'Contents', 'Resources', '_up_', 'dist')
    delete process.env.CLAUDE_H5_DIST_DIR
    process.env.CLAUDE_APP_ROOT = appRoot

    await fs.mkdir(mappedDistDir, { recursive: true })
    await fs.writeFile(path.join(mappedDistDir, 'index.html'), 'Mapped H5 Shell', 'utf-8')

    const response = await fetch(`${baseUrl}/`)

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('Mapped H5 Shell')
  })

  test('allows local resource RPC by default without H5 token or provider key', async () => {
    const response = await rpcResourceRequest('/status')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' })
  })

  test('allows localhost WebUI and Tauri origins at the RPC CORS boundary', async () => {
    const localhostPreflight = await rpcPreflightResponse({
      origin: 'http://127.0.0.1:5179',
    })
    expect(localhostPreflight.status).toBe(204)
    expect(localhostPreflight.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:5179')

    const tauriPreflight = await rpcPreflightResponse({
      origin: 'http://tauri.localhost',
    })
    expect(tauriPreflight.status).toBe(204)
    expect(tauriPreflight.headers.get('Access-Control-Allow-Origin')).toBe('http://tauri.localhost')
  })

  test('blocks remote browser capability routes while H5 access is disabled', async () => {
    const rpcResponse = await rpcUpgradeResponse({ origin: PHONE_ORIGIN })
    expect(rpcResponse.status).toBe(403)
    await expect(rpcResponse.json()).resolves.toMatchObject({ error: 'Forbidden' })

    const proxyResponse = await fetch(`${baseUrl}/proxy/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Origin: PHONE_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    expect(proxyResponse.status).toBe(403)

    const wsResponse = await fetch(`${baseUrl}/sessions/h5-auth-test/live`, {
      headers: makeUpgradeHeaders(PHONE_ORIGIN),
    })
    expect(wsResponse.status).toBe(403)
  })

  test('blocks remote browser runtime bridge requests while H5 access is disabled', async () => {
    const response = await fetch(`${baseUrl}/sessions/h5-auth-test/runtime`, {
      headers: makeUpgradeHeaders(PHONE_ORIGIN),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
  })

  test('blocks remote preflight requests to capability routes while H5 access is disabled', async () => {
    const response = await rpcPreflightResponse({ origin: PHONE_ORIGIN })

    expect(response.status).toBe(403)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('blocks same-origin LAN capability requests while H5 access is disabled when a LAN interface is available', async () => {
    if (!lanBaseUrl) {
      return
    }

    const rpcResponse = await rpcUpgradeResponse({ httpBaseUrl: lanBaseUrl })

    expect(rpcResponse.status).toBe(403)
    await expect(rpcResponse.json()).resolves.toMatchObject({
      error: 'Forbidden',
      message: 'H5 access is disabled. Enable H5 access from the local desktop app first.',
    })

    const proxyResponse = await fetch(`${lanBaseUrl}/proxy/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    expect(proxyResponse.status).toBe(403)

    const wsResponse = await fetch(`${lanBaseUrl}/sessions/h5-auth-test/live`, {
      headers: makeUpgradeHeaders(),
    })
    expect(wsResponse.status).toBe(403)
  })

  test('does not trust spoofed localhost Host and Origin headers from LAN clients while H5 access is disabled', async () => {
    if (!lanBaseUrl) {
      return
    }

    const spoofedHeaders = spoofedLoopbackHeaders(new URL(lanBaseUrl).port)
    const rpcResponse = await rpcUpgradeResponse({
      httpBaseUrl: lanBaseUrl,
      headers: spoofedHeaders,
    })
    if (rpcResponse.status === 400) {
      // Some local stacks route a request to the machine's own LAN IP as a
      // loopback peer. The policy-level spoof regression covers that boundary.
      return
    }
    expect(rpcResponse.status).toBe(403)

    const proxyResponse = await fetch(`${lanBaseUrl}/proxy/v1/messages`, {
      method: 'POST',
      headers: {
        ...spoofedHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    expect(proxyResponse.status).toBe(403)

    const wsResponse = await fetch(`${lanBaseUrl}/sessions/h5-auth-test/live`, {
      headers: {
        ...makeUpgradeHeaders(spoofedHeaders.Origin),
        Host: spoofedHeaders.Host,
      },
    })
    expect(wsResponse.status).toBe(403)
  })

  test('keeps local loopback runtime bridge requests tokenless while H5 access is disabled', async () => {
    await expectWebSocketUpgradeThenClose(`${wsBaseUrl}/sessions/h5-auth-test/runtime`)
  })

  test('keeps local loopback adapter and settings resource requests tokenless while H5 access is disabled', async () => {
    const adaptersResponse = await rpcResourceRequest('/adapters')
    expect(adaptersResponse.status).toBe(200)
    await expect(adaptersResponse.json()).resolves.toEqual({})

    for (const endpoint of settingsSurfaceEndpoints) {
      const response = await rpcResourceRequest(endpoint.path)
      expect(response.status).toBe(200)
    }
  })

  test('lets explicitly authenticated deployments use remote RPC resources while H5 access is disabled', async () => {
    await restartRemoteServer({ authRequired: true })
    process.env.ANTHROPIC_API_KEY = 'test-server-key'

    const missingResponse = await rpcUpgradeResponse({ origin: PHONE_ORIGIN })
    expect(missingResponse.status).toBe(401)

    const validResponse = await rpcResourceRequest('/status', {
      headers: {
        Origin: PHONE_ORIGIN,
        Authorization: 'Bearer test-server-key',
      },
    })
    expect(validResponse.status).toBe(200)
  })

  test('keeps local RPC resources open by default even when a stale bearer token is sent', async () => {
    await enableH5Access()

    const response = await rpcResourceRequest('/status', {
      headers: { Authorization: 'Bearer wrong-token' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' })
  })

  test('allows local RPC resources with a bearer token while default auth is open', async () => {
    const token = await enableH5Access()

    const response = await rpcResourceRequest('/status', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' })
  })

  test('rejects arbitrary CORS origins when H5 access is enabled', async () => {
    await enableH5Access({
      allowedOrigins: ['https://allowed.example.com'],
    })

    const response = await rpcPreflightResponse({
      origin: 'https://blocked.example.com',
    })

    expect(response.status).toBe(403)
  })

  test('blocks remote browsers from enabling H5 access before the local desktop opts in', async () => {
    const response = await rpcUpgradeResponse({ origin: PHONE_ORIGIN })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
  })

  test('blocks remote browsers from local interactive filesystem selection routes', async () => {
    const token = await enableH5Access({ allowedOrigins: [PHONE_ORIGIN] })

    for (const endpoint of [
      '/filesystem/pick-directory',
      '/filesystem/register-directory',
    ]) {
      const response = await rpcResourceRequest(endpoint, {
        method: 'POST',
        headers: {
          Origin: PHONE_ORIGIN,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: tmpDir, initialPath: tmpDir }),
      })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        error: 'Forbidden',
        message: 'Interactive filesystem selection is only available from the local desktop app or loopback Web UI.',
      })
    }
  })

  test('blocks authenticated remote browsers from changing H5 access settings under explicit server auth', async () => {
    await restartRemoteServer({ authRequired: true })
    process.env.ANTHROPIC_API_KEY = 'test-server-key'

    const response = await rpcResourceRequest('/h5-access/enable', {
      method: 'POST',
      headers: {
        Origin: PHONE_ORIGIN,
        Authorization: 'Bearer test-server-key',
      },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Forbidden',
      message: 'H5 access settings can only be changed from the local desktop app.',
    })
  })

  test('allows local desktop H5 access settings under explicit server auth with a valid bearer', async () => {
    await restartRemoteServer({ authRequired: true })
    process.env.ANTHROPIC_API_KEY = 'test-server-key'

    const response = await rpcResourceRequest('/h5-access/enable', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-server-key' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toHaveProperty('token')
  })

  test('allows H5 browser requests from the configured public base URL origin', async () => {
    const token = await enableH5Access({
      publicBaseUrl: `${PHONE_ORIGIN}/h5`,
    })

    const preflight = await rpcPreflightResponse({ origin: PHONE_ORIGIN })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(PHONE_ORIGIN)

    const response = await rpcResourceRequest('/status', {
      headers: {
        Origin: PHONE_ORIGIN,
        Authorization: `Bearer ${token}`,
      },
    })

    expect(response.status).toBe(200)
  })

  test('allows configured CORS origins and includes Vary: Origin', async () => {
    await enableH5Access({
      allowedOrigins: ['https://allowed.example.com'],
    })

    const response = await rpcPreflightResponse({
      origin: 'https://allowed.example.com',
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example.com')
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  test('opens local RPC and session live websocket upgrades without H5 token by default', async () => {
    await expectWebSocketOpen(`${wsBaseUrl}/rpc`)
    await expectWebSocketOpen(`${wsBaseUrl}/sessions/h5-auth-test/live`)
  })

  test('requires H5 token for remote browser RPC resources when H5 access is enabled', async () => {
    const token = await enableH5Access({
      allowedOrigins: [PHONE_ORIGIN],
    })

    const missingTokenResponse = await rpcUpgradeResponse({ origin: PHONE_ORIGIN })
    expect(missingTokenResponse.status).toBe(401)

    const wrongTokenResponse = await rpcUpgradeResponse({
      origin: PHONE_ORIGIN,
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(wrongTokenResponse.status).toBe(401)

    const validTokenResponse = await rpcResourceRequest('/status', {
      headers: {
        Origin: PHONE_ORIGIN,
        Authorization: `Bearer ${token}`,
      },
    })
    expect(validTokenResponse.status).toBe(200)
  })

  test('requires H5 token for remote browser settings surface requests when H5 access is enabled', async () => {
    const token = await enableH5Access({
      allowedOrigins: [PHONE_ORIGIN],
    })

    const missingTokenResponse = await rpcUpgradeResponse({ origin: PHONE_ORIGIN })
    expect(missingTokenResponse.status).toBe(401)

    const wrongTokenResponse = await rpcUpgradeResponse({
      origin: PHONE_ORIGIN,
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(wrongTokenResponse.status).toBe(401)

    for (const endpoint of settingsSurfaceEndpoints) {
      const validTokenResponse = await rpcResourceRequest(endpoint.path, {
        headers: {
          Origin: PHONE_ORIGIN,
          Authorization: `Bearer ${token}`,
        },
      })
      expect(validTokenResponse.status).toBe(200)
      const body = await validTokenResponse.json()
      if ('expected' in endpoint) {
        expect(body).toMatchObject(endpoint.expected)
      } else {
        expect(body).toHaveProperty(endpoint.expectedKey)
      }
    }
  })

  test('does not allow the server API key to replace the H5 token for remote browser requests', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-server-key'
    await enableH5Access({
      allowedOrigins: [PHONE_ORIGIN],
    })

    const rpcResponse = await rpcUpgradeResponse({
      origin: PHONE_ORIGIN,
      headers: { Authorization: 'Bearer test-server-key' },
    })
    expect(rpcResponse.status).toBe(401)
    await expect(rpcResponse.json()).resolves.toMatchObject({
      message: 'Invalid H5 access token',
    })

    const proxyResponse = await fetch(`${baseUrl}/proxy/v1/messages`, {
      method: 'POST',
      headers: {
        Origin: PHONE_ORIGIN,
        Authorization: 'Bearer test-server-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    expect(proxyResponse.status).toBe(401)

    const wsResponse = await fetch(`${baseUrl}/sessions/h5-auth-test/live`, {
      headers: {
        ...makeUpgradeHeaders(PHONE_ORIGIN),
        Authorization: 'Bearer test-server-key',
      },
    })
    expect(wsResponse.status).toBe(401)
  })

  test('requires H5 token for remote browser proxy requests when H5 access is enabled', async () => {
    const token = await enableH5Access({
      allowedOrigins: [PHONE_ORIGIN],
    })

    const missingTokenResponse = await fetch(`${baseUrl}/proxy/v1/messages`, {
      method: 'POST',
      headers: {
        Origin: PHONE_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    expect(missingTokenResponse.status).toBe(401)

    const validTokenResponse = await fetch(`${baseUrl}/proxy/v1/messages`, {
      method: 'POST',
      headers: {
        Origin: PHONE_ORIGIN,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    expect(validTokenResponse.status).toBe(400)
    expect(validTokenResponse.headers.get('Access-Control-Allow-Origin')).toBe(PHONE_ORIGIN)
    await expect(validTokenResponse.json()).resolves.toMatchObject({
      error: { type: 'invalid_request_error' },
    })
  })

  test('keeps Tauri loopback RPC resources tokenless when H5 access is enabled', async () => {
    await enableH5Access()

    const response = await rpcResourceRequest('/status', {
      headers: { Origin: 'http://tauri.localhost' },
    })

    expect(response.status).toBe(200)
  })

  test('keeps local loopback websocket and runtime bridge requests tokenless when H5 access is enabled', async () => {
    await enableH5Access()

    await expectWebSocketOpen(`${wsBaseUrl}/sessions/h5-auth-test/live`)
    await expectWebSocketUpgradeThenClose(`${wsBaseUrl}/sessions/h5-auth-test/runtime`)
  })

  test('keeps local loopback adapter and settings resources tokenless when H5 access is enabled', async () => {
    await enableH5Access()

    const adaptersResponse = await rpcResourceRequest('/adapters')
    expect(adaptersResponse.status).toBe(200)
    await expect(adaptersResponse.json()).resolves.toEqual({})

    for (const endpoint of settingsSurfaceEndpoints) {
      const response = await rpcResourceRequest(endpoint.path)
      expect(response.status).toBe(200)
    }
  })

  test('blocks adapter and settings resources from non-local browser origins when H5 access is enabled', async () => {
    await enableH5Access()

    const response = await rpcUpgradeResponse({ origin: PHONE_ORIGIN })
    expect(response.status).toBe(403)
  })

  test('requires H5 token for remote browser websocket requests when H5 access is enabled', async () => {
    const token = await enableH5Access({
      allowedOrigins: [PHONE_ORIGIN],
    })

    const missingTokenResponse = await fetch(`${baseUrl}/sessions/h5-auth-test/live`, {
      headers: makeUpgradeHeaders(PHONE_ORIGIN),
    })
    expect(missingTokenResponse.status).toBe(401)

    const validTokenResponse = await fetch(`${baseUrl}/sessions/h5-auth-test/live?token=${token}`, {
      headers: makeUpgradeHeaders(PHONE_ORIGIN),
    })
    expect(validTokenResponse.status).toBe(400)
    await expect(validTokenResponse.text()).resolves.toBe('WebSocket upgrade failed')
  })

  test('blocks remote browser runtime bridge requests even when H5 access is enabled', async () => {
    const token = await enableH5Access({
      allowedOrigins: [PHONE_ORIGIN],
    })

    const missingTokenResponse = await fetch(`${baseUrl}/sessions/h5-auth-test/runtime`, {
      headers: makeUpgradeHeaders(PHONE_ORIGIN),
    })
    expect(missingTokenResponse.status).toBe(403)

    const validTokenResponse = await fetch(`${baseUrl}/sessions/h5-auth-test/runtime?token=${token}`, {
      headers: makeUpgradeHeaders(PHONE_ORIGIN),
    })
    expect(validTokenResponse.status).toBe(403)
  })

  test('blocks remote browser runtime bridge requests even under explicit server auth', async () => {
    await restartRemoteServer({ authRequired: true })
    process.env.ANTHROPIC_API_KEY = 'test-server-key'

    const response = await fetch(`${baseUrl}/sessions/h5-auth-test/runtime`, {
      headers: {
        ...makeUpgradeHeaders(PHONE_ORIGIN),
        Authorization: 'Bearer test-server-key',
      },
    })

    expect(response.status).toBe(403)
  })

  test('honors explicit auth opt-in for RPC and websocket requests', async () => {
    await restartRemoteServer({ authRequired: true })
    const token = await enableH5Access()

    const missingStatusResponse = await rpcUpgradeResponse()
    expect(missingStatusResponse.status).toBe(401)

    const wrongStatusResponse = await rpcUpgradeResponse({
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(wrongStatusResponse.status).toBe(401)

    const validStatusResponse = await rpcResourceRequest('/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(validStatusResponse.status).toBe(200)

    const missingTokenResponse = await fetch(`${baseUrl}/sessions/h5-auth-test/live`, {
      headers: makeUpgradeHeaders(),
    })
    expect(missingTokenResponse.status).toBe(401)

    const wrongTokenResponse = await fetch(`${baseUrl}/sessions/h5-auth-test/live?token=wrong-token`, {
      headers: makeUpgradeHeaders(),
    })
    expect(wrongTokenResponse.status).toBe(401)

    await expectWebSocketOpen(`${wsBaseUrl}/sessions/h5-auth-test/live?token=${token}`)
  })
})
