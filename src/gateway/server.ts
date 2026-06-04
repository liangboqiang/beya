import { handleGatewayRequest } from './handler.js'

function readArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function resolveOptions() {
  const host = readArgValue('--host') || process.env.SERVER_HOST || '127.0.0.1'
  const port = Number.parseInt(readArgValue('--port') || process.env.SERVER_PORT || '3456', 10)
  const apiKey = process.env.BEYA_GATEWAY_API_KEY || ''
  return { host, port, apiKey }
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-api-key,last-event-id',
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

function authorize(req: Request, apiKey: string): Response | null {
  if (!apiKey) return null
  const bearer = req.headers.get('authorization') || ''
  const headerKey = req.headers.get('x-api-key') || ''
  const supplied = bearer.toLowerCase().startsWith('bearer ')
    ? bearer.slice('bearer '.length).trim()
    : headerKey.trim()
  if (supplied === apiKey) return null
  return Response.json(
    { error: 'Unauthorized', code: 'AUTHENTICATION_REQUIRED' },
    { status: 401 },
  )
}

function isGatewayPath(pathname: string): boolean {
  return pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/v1/') ||
    pathname === '/health' ||
    pathname === '/readiness'
}

const options = resolveOptions()

Bun.serve({
  hostname: options.host,
  port: options.port,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    if (!isGatewayPath(url.pathname)) {
      return withCors(Response.json({ error: 'Not Found' }, { status: 404 }))
    }
    if (url.pathname !== '/health' && url.pathname !== '/readiness') {
      const authError = authorize(req, options.apiKey)
      if (authError) return withCors(authError)
    }
    try {
      return withCors(await handleGatewayRequest(req, url))
    } catch (error) {
      console.error('[BeyaGateway] request failed', error)
      return withCors(Response.json(
        {
          error: 'Internal gateway error',
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      ))
    }
  },
})

console.log(JSON.stringify({
  service: 'beya-gateway',
  status: 'listening',
  host: options.host,
  port: options.port,
  pid: process.pid,
}))
