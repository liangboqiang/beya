import { buildRpcResourceCall } from '../../src/generated/contracts/index.js'

const [baseUrlArg, methodArg, pathArg, bodyArg] = Bun.argv.slice(2)

if (!baseUrlArg || !methodArg || !pathArg) {
  console.error('Usage: bun run scripts/desktop/rpc-resource-request.ts <baseUrl> <method> <resourcePath> [jsonBody|--stdin]')
  process.exit(2)
}

const bodyText = bodyArg === '--stdin'
  ? await Bun.stdin.text()
  : bodyArg
const body = bodyText && bodyText.trim().length > 0
  ? JSON.parse(bodyText)
  : undefined
const url = new URL(pathArg, baseUrlArg)
const call = buildRpcResourceCall({
  httpMethod: methodArg,
  path: `${url.pathname}${url.search}`,
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body,
})
const requestId = `script-rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`
const wsUrl = new URL('/rpc', baseUrlArg)
wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'

const result = await new Promise<{
  status: number
  result: unknown
}>((resolve, reject) => {
  const ws = new WebSocket(wsUrl.toString())
  const timer = setTimeout(() => {
    ws.close()
    reject(new Error(`Timed out waiting for RPC response for ${methodArg} ${pathArg}`))
  }, 15_000)

  function finish(callback: () => void) {
    clearTimeout(timer)
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
    callback()
  }

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'rpc.request',
      id: requestId,
      method: call.method,
      params: call.params,
    }))
  }
  ws.onerror = () => finish(() => reject(new Error(`RPC WebSocket failed for ${methodArg} ${pathArg}`)))
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      type: string
      id?: string
      status?: number
      result?: unknown
      message?: string
    }
    if (message.type === 'rpc.connected') return
    if (message.id !== requestId) return
    if (message.type === 'rpc.error') {
      finish(() => reject(new Error(message.message || `RPC failed for ${methodArg} ${pathArg}`)))
      return
    }
    finish(() => resolve({ status: message.status || 200, result: message.result ?? null }))
  }
})

if (result.status < 200 || result.status >= 300) {
  console.error(JSON.stringify(result.result))
  process.exit(1)
}

process.stdout.write(JSON.stringify(result.result))
