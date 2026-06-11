import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runOnWindows = process.platform === 'win32' ? test : test.skip

async function getPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a local port')))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

async function waitForHttp(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs
  let lastError = ''

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (response.ok) return response
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(500)
  }

  throw new Error(`Timed out waiting for ${url}${lastError ? ` (${lastError})` : ''}`)
}

async function waitForJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await waitForHttp(url, timeoutMs)
  return response.json() as Promise<T>
}

function collectText(stream: ReadableStream<Uint8Array> | null) {
  let text = ''
  const done = (async () => {
    if (!stream) return
    const reader = stream.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) return
      text += Buffer.from(value).toString('utf8')
    }
  })()

  return {
    get text() {
      return text
    },
    done,
  }
}

function startLegacyHealthOnlyServer(port: number) {
  const code = `
const port = Number(process.env.STALE_SERVER_PORT)
Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'old-beya-server' })
    }
    return new Response('old server without resource RPC', { status: 404 })
  },
})
console.log('legacy-health-only-server-ready')
setInterval(() => {}, 1000)
`

  return Bun.spawn([process.execPath, '-e', code], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STALE_SERVER_PORT: String(port),
    },
    stdout: 'ignore',
    stderr: 'ignore',
  })
}

function startBeyaWebUi(input: {
  serverPort: number
  webPort: number
  configDir: string
  logDir: string
}) {
  return Bun.spawn([
    'powershell.exe',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'start-beya.ps1',
    '-NoOpen',
    '-HostAddress',
    '127.0.0.1',
    '-ServerPort',
    String(input.serverPort),
    '-WebPort',
    String(input.webPort),
    '-LogDir',
    input.logDir,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BEYA_CONFIG_DIR: input.configDir,
      DISABLE_TELEMETRY: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

async function requestAppRpcStatus(serverPort: number) {
  return await new Promise<{
    type: string
    id?: string
    status?: number
    result?: { status?: string; version?: string }
    message?: string
  }>((resolve, reject) => {
    const id = 'start-beya-smoke-status'
    const socket = new WebSocket(`ws://127.0.0.1:${serverPort}/rpc`)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('Resource RPC timed out.'))
    }, 15_000)

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'rpc.request',
        id,
        method: 'status.read',
        params: {},
      }))
    }
    socket.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Resource RPC failed.'))
    }
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        type: string
        id?: string
        status?: number
        result?: { status?: string; version?: string }
        message?: string
      }
      if (message.type === 'rpc.connected') return
      if (message.id !== id) return
      clearTimeout(timer)
      socket.close()
      resolve(message)
    }
  })
}

async function killProcessTree(pid: number | undefined) {
  if (!pid || process.platform !== 'win32') return
  const proc = Bun.spawn(['taskkill.exe', '/PID', String(pid), '/T', '/F'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  await proc.exited.catch(() => undefined)
}

async function stopListenersOnPorts(ports: number[]) {
  if (process.platform !== 'win32' || ports.length === 0) return
  const portList = ports.join(',')
  const command = `
$ports = @(${portList})
foreach ($port in $ports) {
  Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    ForEach-Object {
      Stop-Process -Id ([int]$_.OwningProcess) -Force -ErrorAction SilentlyContinue
    }
}
`
  const proc = Bun.spawn(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  await proc.exited.catch(() => undefined)
}

async function readLogSummary(logDir: string) {
  try {
    const entries = await readdir(logDir)
    const chunks: string[] = []
    for (const entry of entries.filter((name) => name.endsWith('.log'))) {
      const content = await readFile(join(logDir, entry), 'utf8').catch(() => '')
      if (content.trim()) {
        chunks.push(`[${entry}]\n${content.slice(-4000)}`)
      }
    }
    return chunks.join('\n')
  } catch {
    return ''
  }
}

describe('start-beya Web UI startup smoke', () => {
  runOnWindows('replaces stale health-only servers and keeps the app RPC bootstrap healthy', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'start-beya-smoke-'))
    const configDir = join(tmpRoot, 'config')
    const logDir = join(tmpRoot, 'logs')
    const serverPort = await getPort()
    const webPort = await getPort()

    const staleServer = startLegacyHealthOnlyServer(serverPort)
    let startBeya: ReturnType<typeof startBeyaWebUi> | null = null
    let stdout: ReturnType<typeof collectText> | null = null
    let stderr: ReturnType<typeof collectText> | null = null

    try {
      await waitForHttp(`http://127.0.0.1:${serverPort}/health`, 10_000)
      startBeya = startBeyaWebUi({ serverPort, webPort, configDir, logDir })
      stdout = collectText(startBeya.stdout)
      stderr = collectText(startBeya.stderr)

      const webStatus = await waitForJson<{
        app: string
        serverUrl: string | null
        launchedByStartScript: boolean
        webPort: number | null
      }>(`http://127.0.0.1:${webPort}/__beya_web_ui_status`, 60_000)

      expect(webStatus).toMatchObject({
        app: 'beya-desktop-web-ui',
        serverUrl: `http://127.0.0.1:${serverPort}`,
        launchedByStartScript: true,
        webPort,
      })

      const appRpcStatus = await requestAppRpcStatus(serverPort)

      expect(appRpcStatus).toMatchObject({
        type: 'rpc.response',
        status: 200,
        result: expect.objectContaining({
          status: 'ok',
        }),
      })
      expect(stdout?.text).toContain('not a compatible Beya RPC server; stopping it')
    } catch (error) {
      const logs = await readLogSummary(logDir)
      throw new Error([
        error instanceof Error ? error.message : String(error),
        '',
        '[start-beya stdout]',
        stdout?.text.slice(-4000) ?? '',
        '',
        '[start-beya stderr]',
        stderr?.text.slice(-4000) ?? '',
        '',
        '[start-beya logs]',
        logs,
      ].join('\n'))
    } finally {
      await killProcessTree(startBeya?.pid)
      await killProcessTree(staleServer.pid)
      await Promise.all([
        startBeya?.exited.catch(() => undefined),
        staleServer.exited.catch(() => undefined),
        stdout?.done.catch(() => undefined),
        stderr?.done.catch(() => undefined),
      ])
      await stopListenersOnPorts([serverPort, webPort])
      await rm(tmpRoot, { recursive: true, force: true })
    }
  }, 120_000)
})
