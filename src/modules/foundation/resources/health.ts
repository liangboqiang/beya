export async function handleHealthResource(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json(
      { error: 'Method Not Allowed', message: `Method ${req.method} not allowed on /health` },
      { status: 405 },
    )
  }

  return Response.json({
    status: 'ok',
    service: 'beya-server',
    timestamp: new Date().toISOString(),
  })
}

export async function handleReadyResource(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json(
      { error: 'Method Not Allowed', message: `Method ${req.method} not allowed on /ready` },
      { status: 405 },
    )
  }

  return Response.json({
    status: 'ready',
    service: 'beya-server',
    timestamp: new Date().toISOString(),
  })
}
