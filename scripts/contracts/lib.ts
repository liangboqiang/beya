import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { parse } from 'yaml'

const PROTOCOL_DIRS = ['gateway', 'session', 'runtime', 'resources', 'events']
const ROOT = process.cwd()
const CONTRACTS_ROOT = join(ROOT, 'contracts')
const PROTOCOL_SCHEMA_PATH = join(CONTRACTS_ROOT, 'meta', 'protocol.schema.json')
const MODULE_SCHEMA_PATH = join(CONTRACTS_ROOT, 'meta', 'module.schema.json')
const CAPABILITY_SCHEMA_PATH = join(CONTRACTS_ROOT, 'meta', 'capability.schema.json')
const EXECUTOR_SCHEMA_PATH = join(CONTRACTS_ROOT, 'meta', 'executor.schema.json')

type JsonSchema = Record<string, unknown>

export type ResourceHandlerBinding = {
  module: string
  export: string
}

export type ContractItem = {
  name: string
  direction?: string
  owner?: string
  auth?: 'none' | 'local-trusted' | 'runtime' | 'user'
  request?: JsonSchema
  response?: JsonSchema
  client?: {
    exposed: boolean
    name?: string
  }
  resource?: {
    httpMethod: string
    path: string
    handler?: ResourceHandlerBinding
  }
  deprecated?: boolean
}

export type ContractDocument = {
  name: string
  version: string
  domain: string
  stability: string
  description?: string
  transport?: {
    kind: string
    path: string
  }
  methods?: ContractItem[]
  messages?: ContractItem[]
  events?: ContractItem[]
}

export type ModuleDocument = {
  id: string
  version: string
  name?: string
  layer: string
  layerOrder?: number
  stability: string
  description?: string
  paths?: {
    server?: string[]
    desktop?: string[]
    contracts?: string[]
  }
  owns: string[]
  resourceMethods?: string[]
  events?: string[]
  persistence?: Array<{
    id: string
    owner: string
    path: string
    migrationRequired?: boolean
  }>
  allowedDependencies: string[]
  forbiddenDependencies?: string[]
  implementationRoots?: string[]
}

export type CapabilityDocument = {
  id: string
  version: string
  kind: 'tool' | 'skill' | 'plugin' | 'agent' | 'workflow'
  owner: string
  stability: string
  description?: string
  input?: JsonSchema
  output?: JsonSchema
  events?: string[]
  permissions?: string[]
  implementation: ResourceHandlerBinding
}

export type ExecutorDocument = {
  id: string
  version: string
  kind: 'agent' | 'workflow' | 'capability'
  owner: string
  stability: string
  description?: string
  input?: JsonSchema
  output?: JsonSchema
  implementation: ResourceHandlerBinding
  emits?: string[]
  consumes?: string[]
}

export type LoadedDocument<T> = {
  path: string
  document: T
}

export type LoadedContract = LoadedDocument<ContractDocument>
export type LoadedModule = LoadedDocument<ModuleDocument>
export type LoadedCapability = LoadedDocument<CapabilityDocument>
export type LoadedExecutor = LoadedDocument<ExecutorDocument>

export type ResourceMethod = {
  name: string
  owner: string
  auth: string
  clientName: string
  clientExposed: boolean
  httpMethod: string
  path: string
  handler: ResourceHandlerBinding
}

export type GeneratedContractModel = {
  schemaHash: string
  paths: {
    rpc: string
    sessionLive: string
    sessionRuntime: string
  }
  rpcMethods: string[]
  liveCommands: string[]
  liveEvents: string[]
  runtimeMessages: string[]
  eventBusEvents: string[]
  modules: ModuleDocument[]
  capabilities: CapabilityDocument[]
  executors: ExecutorDocument[]
  rpcResourceMethods: ResourceMethod[]
}

export function loadContractFiles(): LoadedContract[] {
  const files = PROTOCOL_DIRS.flatMap((dir) =>
    collectYamlFiles(join(CONTRACTS_ROOT, dir)),
  ).sort()

  return files.map((file) => ({
    path: file,
    document: parse(readFileSync(file, 'utf8')) as ContractDocument,
  }))
}

export function loadModuleFiles(): LoadedModule[] {
  return collectYamlFiles(join(CONTRACTS_ROOT, 'modules')).sort().map((file) => ({
    path: file,
    document: parse(readFileSync(file, 'utf8')) as ModuleDocument,
  }))
}

export function loadCapabilityFiles(): LoadedCapability[] {
  return collectYamlFiles(join(CONTRACTS_ROOT, 'capabilities')).sort().map((file) => ({
    path: file,
    document: parse(readFileSync(file, 'utf8')) as CapabilityDocument,
  }))
}

export function loadExecutorFiles(): LoadedExecutor[] {
  return collectYamlFiles(join(CONTRACTS_ROOT, 'executors')).sort().map((file) => ({
    path: file,
    document: parse(readFileSync(file, 'utf8')) as ExecutorDocument,
  }))
}

export function validateContracts(
  contracts = loadContractFiles(),
  modules = loadModuleFiles(),
  capabilities = loadCapabilityFiles(),
  executors = loadExecutorFiles(),
): string[] {
  const errors: string[] = []
  validateDocuments('protocol', contracts, PROTOCOL_SCHEMA_PATH, errors)
  validateDocuments('module', modules, MODULE_SCHEMA_PATH, errors)
  validateDocuments('capability', capabilities, CAPABILITY_SCHEMA_PATH, errors)
  validateDocuments('executor', executors, EXECUTOR_SCHEMA_PATH, errors)
  if (errors.length > 0) return errors

  const seenNames = new Map<string, string>()
  const seenResources = new Map<string, string>()
  const moduleIds = new Set(modules.map((entry) => entry.document.id))
  const moduleResourceMethods = new Map<string, string>()

  for (const module of modules) {
    const rel = relPath(module.path)
    for (const dependency of module.document.allowedDependencies) {
      if (!moduleIds.has(dependency)) {
        errors.push(`${rel}: unknown allowed dependency ${dependency}`)
      }
    }
    for (const dependency of module.document.forbiddenDependencies ?? []) {
      if (!moduleIds.has(dependency)) {
        errors.push(`${rel}: unknown forbidden dependency ${dependency}`)
      }
      if (module.document.allowedDependencies.includes(dependency)) {
        errors.push(`${rel}: ${dependency} cannot be both allowed and forbidden`)
      }
    }
    for (const methodName of module.document.resourceMethods ?? []) {
      const previous = moduleResourceMethods.get(methodName)
      if (previous) {
        errors.push(`${rel}: resource method ${methodName} already owned by ${previous}`)
      } else {
        moduleResourceMethods.set(methodName, module.document.id)
      }
    }
  }

  for (const contract of contracts) {
    const rel = relPath(contract.path)
    const registerName = (kind: string, item: ContractItem) => {
      const key = `${kind}:${item.name}`
      const previous = seenNames.get(key)
      if (previous) {
        errors.push(`${rel}: duplicate ${kind} name ${item.name}; first declared in ${previous}`)
      } else {
        seenNames.set(key, rel)
      }
    }

    for (const method of contract.document.methods ?? []) {
      registerName('method', method)
      if (!method.resource) continue
      const resourceKey = `${method.resource.httpMethod}:${method.resource.path}`
      const previousResource = seenResources.get(resourceKey)
      if (previousResource) {
        errors.push(`${rel}: duplicate resource route ${resourceKey}; first declared in ${previousResource}`)
      } else {
        seenResources.set(resourceKey, rel)
      }
      validateResourceMethod(rel, method, moduleIds, moduleResourceMethods, errors)
    }
    for (const message of contract.document.messages ?? []) registerName('message', message)
    for (const event of contract.document.events ?? []) registerName('event', event)
  }

  for (const capability of capabilities) {
    const rel = relPath(capability.path)
    if (!moduleIds.has(capability.document.owner)) {
      errors.push(`${rel}: unknown owner module ${capability.document.owner}`)
    }
    validateImplementationBinding(rel, capability.document.implementation, errors)
  }

  for (const executor of executors) {
    const rel = relPath(executor.path)
    if (!moduleIds.has(executor.document.owner)) {
      errors.push(`${rel}: unknown owner module ${executor.document.owner}`)
    }
    validateImplementationBinding(rel, executor.document.implementation, errors)
  }

  const model = buildGeneratedModel(contracts, modules, capabilities, executors)
  if (model.paths.rpc !== '/rpc') {
    errors.push(`gateway rpc path must be /rpc, got ${model.paths.rpc}`)
  }
  if (model.paths.sessionLive !== '/sessions/{sessionId}/live') {
    errors.push(`session live path must be /sessions/{sessionId}/live, got ${model.paths.sessionLive}`)
  }
  if (model.paths.sessionRuntime !== '/sessions/{sessionId}/runtime') {
    errors.push(`session runtime path must be /sessions/{sessionId}/runtime, got ${model.paths.sessionRuntime}`)
  }

  return errors
}

export function buildGeneratedModel(
  contracts = loadContractFiles(),
  modules = loadModuleFiles(),
  capabilities = loadCapabilityFiles(),
  executors = loadExecutorFiles(),
): GeneratedContractModel {
  const sortedContracts = contracts
    .map((entry) => ({
      path: relPath(entry.path),
      document: entry.document,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const sortedModules = modules.map((entry) => entry.document).sort((a, b) => a.id.localeCompare(b.id))
  const sortedCapabilities = capabilities.map((entry) => entry.document).sort((a, b) => a.id.localeCompare(b.id))
  const sortedExecutors = executors.map((entry) => entry.document).sort((a, b) => a.id.localeCompare(b.id))
  const hashInput = JSON.stringify({
    contracts: sortedContracts,
    modules: sortedModules,
    capabilities: sortedCapabilities,
    executors: sortedExecutors,
  })
  const schemaHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16)
  const byName = new Map(sortedContracts.map((entry) => [entry.document.name, entry.document]))
  const rpc = byName.get('gateway.rpc')
  const live = byName.get('session.live')
  const runtime = byName.get('runtime.bridge')

  return {
    schemaHash,
    paths: {
      rpc: rpc?.transport?.path ?? '',
      sessionLive: live?.transport?.path ?? '',
      sessionRuntime: runtime?.transport?.path ?? '',
    },
    rpcMethods: uniqueSorted(
      sortedContracts.flatMap((entry) => entry.document.methods ?? []).map((item) => item.name),
    ),
    liveCommands: uniqueSorted(
      (live?.messages ?? [])
        .filter((item) => item.direction === 'client-to-server')
        .map((item) => item.name),
    ),
    liveEvents: uniqueSorted(
      (live?.messages ?? [])
        .filter((item) => item.direction === 'server-to-client')
        .map((item) => item.name),
    ),
    runtimeMessages: uniqueSorted(
      (runtime?.messages ?? []).map((item) => item.name),
    ),
    eventBusEvents: uniqueSorted(
      sortedContracts.flatMap((entry) => entry.document.events ?? []).map((item) => item.name),
    ),
    modules: sortedModules,
    capabilities: sortedCapabilities,
    executors: sortedExecutors,
    rpcResourceMethods: sortedContracts
      .flatMap((entry) => entry.document.methods ?? [])
      .filter((item): item is ContractItem & {
        owner: string
        auth: string
        client: { exposed: boolean; name?: string }
        resource: { httpMethod: string; path: string; handler: ResourceHandlerBinding }
      } => Boolean(item.resource?.handler && item.owner && item.auth && item.client))
      .map((item) => ({
        name: item.name,
        owner: item.owner,
        auth: item.auth,
        clientName: item.client.name ?? toClientName(item.name),
        clientExposed: item.client.exposed,
        httpMethod: item.resource.httpMethod,
        path: item.resource.path,
        handler: item.resource.handler,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export function generateTypeScript(model = buildGeneratedModel()): string {
  return `// Generated by scripts/contracts/generate.ts. Do not edit manually.
export const CONTRACT_SCHEMA_HASH = '${model.schemaHash}'

export const RPC_PATH = '${model.paths.rpc}'
export const SESSION_LIVE_PATH_TEMPLATE = '${model.paths.sessionLive}'
export const SESSION_RUNTIME_PATH_TEMPLATE = '${model.paths.sessionRuntime}'

export const RPC_METHODS = ${tsArray(model.rpcMethods)} as const
export type RpcMethod = typeof RPC_METHODS[number]

export const RPC_METHOD_REGISTRY = ${tsRegistry(model.rpcResourceMethods)} as const
export type RpcMethodRegistry = typeof RPC_METHOD_REGISTRY
const RPC_RESOURCE_MATCH_METHODS = ${tsArray(sortResourceMethodsForMatching(model.rpcResourceMethods).map((entry) => entry.name))} as const

export const SESSION_LIVE_COMMANDS = ${tsArray(model.liveCommands)} as const
export type SessionLiveCommand = typeof SESSION_LIVE_COMMANDS[number]

export const SESSION_LIVE_EVENTS = ${tsArray(model.liveEvents)} as const
export type SessionLiveEvent = typeof SESSION_LIVE_EVENTS[number]

export const RUNTIME_MESSAGES = ${tsArray(model.runtimeMessages)} as const
export type RuntimeMessage = typeof RUNTIME_MESSAGES[number]

export const EVENT_BUS_EVENTS = ${tsArray(model.eventBusEvents)} as const
export type EventBusEvent = typeof EVENT_BUS_EVENTS[number]

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type ContractMessage<TType extends string = string> = {
  type: TType
  [key: string]: JsonValue
}

export type SessionLiveCommandPayload = {
  [key: string]: JsonValue | undefined
}

export type RpcResourceParams = {
  path?: Record<string, string>
  query?: Record<string, string | string[] | number | boolean | null | undefined>
  headers?: Record<string, string>
  body?: JsonValue | string
}

export type RpcResourceCall = {
  method: RpcMethod
  params: RpcResourceParams
}

export function buildSessionLivePath(sessionId: string): string {
  return SESSION_LIVE_PATH_TEMPLATE.replace('{sessionId}', encodeURIComponent(sessionId))
}

export function buildSessionRuntimePath(sessionId: string): string {
  return SESSION_RUNTIME_PATH_TEMPLATE.replace('{sessionId}', encodeURIComponent(sessionId))
}

export function buildSessionLiveCommand(
  command: SessionLiveCommand,
  payload: SessionLiveCommandPayload = {},
): ContractMessage {
  return compactContractMessage({
    type: command,
    ...payload,
  })
}

export function createRpcResourceCall(
  method: RpcMethod,
  params: RpcResourceParams = {},
): RpcResourceCall {
  if (!isRpcMethod(method)) {
    throw new Error(\`Unknown contract RPC method: \${method}\`)
  }
  if (!RPC_METHOD_REGISTRY[method]) {
    throw new Error(\`RPC method \${method} is not a resource method\`)
  }
  return {
    method,
    params: compactRpcParams(params),
  }
}

export function buildRpcResourcePath(method: RpcMethod, params: RpcResourceParams = {}): string {
  const spec = RPC_METHOD_REGISTRY[method]
  if (!spec) {
    throw new Error(\`RPC method \${method} is not a resource method\`)
  }
  const pathParams = isStringRecord(params.path) ? params.path : {}
  const query = isQueryRecord(params.query) ? normalizeQueryRecord(params.query) : {}
  return appendQuery(renderResourceTemplate(spec.path, pathParams), query)
}

/**
 * @deprecated Production code should use createRpcResourceCall(method, params).
 * This helper exists for drift checks and route negative tests only.
 */
export function buildRpcResourceCall(input: {
  httpMethod: string
  path: string
  headers?: Record<string, string>
  body?: JsonValue | string
}): RpcResourceCall {
  const normalized = ensureResourcePath(input.path)
  const url = new URL(normalized, 'http://beya.local')
  const httpMethod = input.httpMethod.toUpperCase()
  const pathname = url.pathname
  const query = queryFromSearchParams(url.searchParams)

  for (const method of RPC_RESOURCE_MATCH_METHODS) {
    const spec = RPC_METHOD_REGISTRY[method]
    if (!spec || spec.httpMethod !== httpMethod) continue
    const pathParams = matchResourceTemplate(spec.path, pathname)
    if (!pathParams) continue
    return createRpcResourceCall(method, {
      path: pathParams,
      query,
      headers: input.headers,
      body: input.body,
    })
  }

  throw new Error(\`No contract RPC method matches \${httpMethod} \${pathname}\`)
}

export function resolveRpcResourceCall(method: RpcMethod, params: unknown): {
  httpMethod: string
  path: string
  headers: Record<string, string>
  body?: JsonValue | string
} | null {
  if (!isRecord(params)) return null
  const headers = isStringRecord(params.headers) ? params.headers : {}
  const body = params.body as JsonValue | string | undefined

  const spec = RPC_METHOD_REGISTRY[method]
  if (!spec) return null
  const pathParams = isStringRecord(params.path) ? params.path : {}
  const query = isQueryRecord(params.query) ? normalizeQueryRecord(params.query) : {}
  return {
    httpMethod: spec.httpMethod,
    path: appendQuery(renderResourceTemplate(spec.path, pathParams), query),
    headers,
    body,
  }
}

export function isRpcMethod(value: unknown): value is RpcMethod {
  return typeof value === 'string' && (RPC_METHODS as readonly string[]).includes(value)
}

export function isSessionLiveCommand(value: unknown): value is SessionLiveCommand {
  return typeof value === 'string' && (SESSION_LIVE_COMMANDS as readonly string[]).includes(value)
}

export function isSessionLiveEvent(value: unknown): value is SessionLiveEvent {
  return typeof value === 'string' && (SESSION_LIVE_EVENTS as readonly string[]).includes(value)
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return typeof value === 'string' && (RUNTIME_MESSAGES as readonly string[]).includes(value)
}

export function isEventBusEvent(value: unknown): value is EventBusEvent {
  return typeof value === 'string' && (EVENT_BUS_EVENTS as readonly string[]).includes(value)
}

export function validateContractMessage(value: unknown): value is ContractMessage {
  return isRecord(value) && typeof value.type === 'string'
}

function ensureResourcePath(path: string): string {
  return path.startsWith('/') ? path : \`/\${path}\`
}

function matchResourceTemplate(template: string, pathname: string): Record<string, string> | null {
  const templateParts = template.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (templateParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < templateParts.length; i++) {
    const templatePart = templateParts[i]!
    const pathPart = pathParts[i]!
    const paramName = templatePart.match(/^\\{([A-Za-z0-9_]+)\\}$/)?.[1]
    if (paramName) {
      params[paramName] = decodeURIComponent(pathPart)
      continue
    }
    if (templatePart !== pathPart) return null
  }
  return params
}

function renderResourceTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\\{([A-Za-z0-9_]+)\\}/g, (_match, name: string) =>
    encodeURIComponent(params[name] ?? ''),
  )
}

function queryFromSearchParams(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    if (values.length === 1) {
      query[key] = values[0]!
    } else if (values.length > 1) {
      query[key] = values
    }
  }
  return query
}

function normalizeQueryRecord(
  query: Record<string, string | string[] | number | boolean | null | undefined>,
): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue
    normalized[key] = Array.isArray(value)
      ? value.map((entry) => String(entry))
      : String(value)
  }
  return normalized
}

function appendQuery(path: string, query: Record<string, string | string[]>): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const entry of value) searchParams.append(key, entry)
    } else {
      searchParams.set(key, value)
    }
  }
  const queryString = searchParams.toString()
  return queryString ? \`\${path}?\${queryString}\` : path
}

function compactRpcParams(params: RpcResourceParams): RpcResourceParams {
  const result: RpcResourceParams = {}
  if (params.path && Object.keys(params.path).length > 0) result.path = params.path
  if (params.query && Object.keys(params.query).length > 0) result.query = params.query
  if (params.headers && Object.keys(params.headers).length > 0) result.headers = params.headers
  if (params.body !== undefined) result.body = params.body
  return result
}

function compactContractMessage(message: ContractMessage): ContractMessage {
  return Object.fromEntries(
    Object.entries(message).filter(([, value]) => value !== undefined),
  ) as ContractMessage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function isQueryRecord(value: unknown): value is Record<string, string | string[] | number | boolean | null | undefined> {
  return isRecord(value) && Object.values(value).every((entry) =>
    typeof entry === 'string' ||
    typeof entry === 'number' ||
    typeof entry === 'boolean' ||
    entry === null ||
    entry === undefined ||
    (Array.isArray(entry) && entry.every((item) => typeof item === 'string')),
  )
}
`
}

export function generateModulesIndex(model = buildGeneratedModel()): string {
  return `// Generated by scripts/contracts/generate.ts. Do not edit manually.
export const MODULE_REGISTRY = ${json(model.modules)} as const
export type ModuleId = typeof MODULE_REGISTRY[number]['id']

export const MODULE_DEPENDENCY_GRAPH = ${json(Object.fromEntries(
    model.modules.map((entry) => [entry.id, entry.allowedDependencies]),
  ))} as const

export const RESOURCE_METHOD_OWNERS = ${json(Object.fromEntries(
    model.rpcResourceMethods.map((entry) => [entry.name, entry.owner]),
  ))} as const

export const RESOURCE_METHODS_BY_MODULE = ${json(groupResourceMethodsByOwner(model.rpcResourceMethods))} as const

export const EVENT_BUS_EVENTS_BY_MODULE = ${json(Object.fromEntries(
    model.modules.map((entry) => [entry.id, entry.events ?? []]),
  ))} as const

export const PERSISTENCE_OWNERS = ${json(model.modules.flatMap((entry) =>
    (entry.persistence ?? []).map((item) => ({ ...item, module: entry.id })),
  ))} as const

export const ARCHITECTURE_GRAPH = {
  modules: MODULE_REGISTRY,
  dependencies: MODULE_DEPENDENCY_GRAPH,
  resourceOwners: RESOURCE_METHOD_OWNERS,
  eventOwners: EVENT_BUS_EVENTS_BY_MODULE,
  persistenceOwners: PERSISTENCE_OWNERS,
} as const
`
}

export function generateResourceHandlers(model = buildGeneratedModel()): string {
  const handlers = uniqueHandlers(model.rpcResourceMethods)
  const imports = handlers.map((handler, index) =>
    `import { ${handler.export} as rawResourceHandler${index} } from '${relativeImport('src/generated/modules/resourceHandlers.ts', handler.module)}'`,
  )
  const wrappers = handlers.map((handler, index) => {
    if (handler.export === 'handleFilesystemRoute') {
      return `const resourceHandler${index}: GeneratedResourceHandler = (req, url, _segments, options) => rawResourceHandler${index}(url.pathname, url, req, options?.filesystem as never)`
    }
    return `const resourceHandler${index}: GeneratedResourceHandler = (req, url, segments) => rawResourceHandler${index}(req, url, segments)`
  })
  const handlerEntries = model.rpcResourceMethods.map((method) => {
    const index = handlers.findIndex((handler) =>
      handler.module === method.handler.module && handler.export === method.handler.export,
    )
    return `  '${method.name}': { method: '${method.name}', httpMethod: '${method.httpMethod}', path: '${method.path}', owner: '${method.owner}', handler: resourceHandler${index} },`
  })
  const segmentEntries = uniqueSegmentHandlers(model.rpcResourceMethods).map((entry) => {
    const index = handlers.findIndex((handler) =>
      handler.module === entry.handler.module && handler.export === entry.handler.export,
    )
    return `  '${entry.segment}': resourceHandler${index},`
  })

  return `// Generated by scripts/contracts/generate.ts. Do not edit manually.
import type { RpcMethod } from '../contracts/index.js'
${imports.join('\n')}

export type GeneratedResourceRequestOptions = {
  filesystem?: unknown
}

export type GeneratedResourceHandler = (
  req: Request,
  url: URL,
  segments: string[],
  options?: GeneratedResourceRequestOptions,
) => Promise<Response>

type ResourceRouteSpec = {
  method: RpcMethod
  httpMethod: string
  path: string
  owner: string
  handler: GeneratedResourceHandler
}

${wrappers.join('\n')}

export const RESOURCE_ROUTE_REGISTRY = {
${handlerEntries.join('\n')}
} as const satisfies Record<string, ResourceRouteSpec>

const RESOURCE_SEGMENT_HANDLERS = {
${segmentEntries.join('\n')}
} as const

export function resolveGeneratedResourceMethod(httpMethod: string, pathname: string): RpcMethod | null {
  const normalizedMethod = httpMethod.toUpperCase()
  for (const spec of Object.values(RESOURCE_ROUTE_REGISTRY)) {
    if (spec.httpMethod !== normalizedMethod) continue
    if (!matchResourceTemplate(spec.path, pathname)) continue
    return spec.method
  }
  return null
}

export async function dispatchGeneratedResourceRequest(
  req: Request,
  url: URL,
  options: GeneratedResourceRequestOptions = {},
): Promise<Response> {
  const method = resolveGeneratedResourceMethod(req.method, url.pathname)
  const segments = ['resource', ...url.pathname.split('/').filter(Boolean)]
  if (method) {
    return RESOURCE_ROUTE_REGISTRY[method].handler(req, url, segments, options)
  }

  const segment = segments[1]
  const handler = segment ? RESOURCE_SEGMENT_HANDLERS[segment as keyof typeof RESOURCE_SEGMENT_HANDLERS] : undefined
  if (handler) {
    return handler(req, url, segments, options)
  }

  return Response.json(
    { error: 'Not Found', message: \`Unknown resource path: \${url.pathname}\` },
    { status: 404 },
  )
}

function matchResourceTemplate(template: string, pathname: string): Record<string, string> | null {
  const templateParts = template.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (templateParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < templateParts.length; i++) {
    const templatePart = templateParts[i]!
    const pathPart = pathParts[i]!
    const paramName = templatePart.match(/^\\{([A-Za-z0-9_]+)\\}$/)?.[1]
    if (paramName) {
      params[paramName] = decodeURIComponent(pathPart)
      continue
    }
    if (templatePart !== pathPart) return null
  }
  return params
}
`
}

export function generateExecutors(model = buildGeneratedModel()): string {
  return `// Generated by scripts/contracts/generate.ts. Do not edit manually.
export const EXECUTOR_REGISTRY = ${json(model.executors)} as const
export type ExecutorId = typeof EXECUTOR_REGISTRY[number]['id']

export const CAPABILITY_REGISTRY = ${json(model.capabilities)} as const
export type CapabilityId = typeof CAPABILITY_REGISTRY[number]['id']

export function getExecutor(id: ExecutorId) {
  return EXECUTOR_REGISTRY.find((entry) => entry.id === id)
}

export function dispatchCapabilityExecutor(id: CapabilityId, input: unknown): { id: CapabilityId; input: unknown } {
  return { id, input }
}
`
}

export function generateDesktopResources(model = buildGeneratedModel()): string {
  const domains = groupResourceMethodsByDomain(model.rpcResourceMethods.filter((entry) => entry.clientExposed))
  const domainEntries = Object.entries(domains).map(([domain, methods]) => {
    const methodEntries = methods.map((method) => {
      const [, action] = method.name.split('.')
      return `    ${action}: <T = unknown>(params: RpcResourceParams = {}, options?: ResourceRequestOptions) => callResource<T>('${method.name}', params, options),`
    })
    return `  ${domain}: {\n${methodEntries.join('\n')}\n  },`
  })

  return `// Generated by scripts/contracts/generate.ts. Do not edit manually.
import type { RpcMethod, RpcResourceParams } from '../../../../src/generated/contracts'
import { sendNamedResourceRpc } from '../../modules/resources/transport'

export type ResourceRequestOptions = {
  timeout?: number
}

export function callResource<T = unknown>(
  method: RpcMethod,
  params: RpcResourceParams = {},
  options?: ResourceRequestOptions,
): Promise<T> {
  return sendNamedResourceRpc<T>(method, params, options)
}

export const resourceClient = {
${domainEntries.join('\n')}
} as const

export function useResourceClient() {
  return resourceClient
}
`
}

export function generatePython(model = buildGeneratedModel()): string {
  return `# Generated by scripts/contracts/generate.ts. Do not edit manually.
from typing import Any, Dict, Literal, Optional, Tuple
from urllib.parse import quote

CONTRACT_SCHEMA_HASH = "${model.schemaHash}"

RPC_PATH = "${model.paths.rpc}"
SESSION_LIVE_PATH_TEMPLATE = "${model.paths.sessionLive}"
SESSION_RUNTIME_PATH_TEMPLATE = "${model.paths.sessionRuntime}"

RPC_METHODS = ${pyTuple(model.rpcMethods)}
RPC_METHOD_REGISTRY = ${pyRegistry(model.rpcResourceMethods)}
RPC_RESOURCE_MATCH_METHODS = ${pyTuple(sortResourceMethodsForMatching(model.rpcResourceMethods).map((entry) => entry.name))}
SESSION_LIVE_COMMANDS = ${pyTuple(model.liveCommands)}
SESSION_LIVE_EVENTS = ${pyTuple(model.liveEvents)}
RUNTIME_MESSAGES = ${pyTuple(model.runtimeMessages)}
EVENT_BUS_EVENTS = ${pyTuple(model.eventBusEvents)}

RpcMethod = Literal${pyLiteralTuple(model.rpcMethods)}
SessionLiveCommand = Literal${pyLiteralTuple(model.liveCommands)}
SessionLiveEvent = Literal${pyLiteralTuple(model.liveEvents)}
RuntimeMessage = Literal${pyLiteralTuple(model.runtimeMessages)}
EventBusEvent = Literal${pyLiteralTuple(model.eventBusEvents)}

JsonObject = Dict[str, Any]
RpcResourceParams = Dict[str, Any]


def build_session_live_path(session_id: str) -> str:
    return SESSION_LIVE_PATH_TEMPLATE.replace("{sessionId}", quote(str(session_id), safe=""))


def build_session_runtime_path(session_id: str) -> str:
    return SESSION_RUNTIME_PATH_TEMPLATE.replace("{sessionId}", quote(str(session_id), safe=""))


def build_session_live_command(command: SessionLiveCommand, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    data = dict(payload or {})
    data["type"] = command
    return {key: value for key, value in data.items() if value is not None}


def create_rpc_resource_call(method: RpcMethod, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if method not in RPC_METHOD_REGISTRY:
        raise ValueError(f"RPC method {method} is not a resource method")
    return {"method": method, "params": _compact_rpc_params(dict(params or {}))}


def build_rpc_resource_path(method: RpcMethod, params: Optional[Dict[str, Any]] = None) -> str:
    spec = RPC_METHOD_REGISTRY.get(method)
    if not spec:
        raise ValueError(f"RPC method {method} is not a resource method")
    params = params or {}
    return _append_query(
        _render_resource_template(str(spec["path"]), params.get("path") or {}),
        params.get("query") or {},
    )


def build_rpc_resource_call(http_method: str, path: str, headers: Optional[Dict[str, str]] = None, body: Any = None) -> Dict[str, Any]:
    normalized = _ensure_resource_path(path)
    pathname, query = _split_resource_path(normalized)
    resolved_method = http_method.upper()

    for method in RPC_RESOURCE_MATCH_METHODS:
        spec = RPC_METHOD_REGISTRY.get(method)
        if not spec or spec.get("httpMethod") != resolved_method:
            continue
        path_params = _match_resource_template(str(spec["path"]), pathname)
        if path_params is None:
            continue
        return create_rpc_resource_call(method, {
            "path": path_params,
            "query": query,
            "headers": headers or {},
            "body": body,
        })

    raise ValueError(f"No contract RPC method matches {resolved_method} {pathname}")


def is_rpc_method(value: object) -> bool:
    return isinstance(value, str) and value in RPC_METHODS


def is_session_live_command(value: object) -> bool:
    return isinstance(value, str) and value in SESSION_LIVE_COMMANDS


def is_session_live_event(value: object) -> bool:
    return isinstance(value, str) and value in SESSION_LIVE_EVENTS


def _ensure_resource_path(path: str) -> str:
    return path if path.startswith("/") else "/" + path


def _split_resource_path(path: str) -> Tuple[str, Dict[str, Any]]:
    from urllib.parse import parse_qs, urlsplit

    parsed = urlsplit(path)
    query: Dict[str, Any] = {}
    for key, values in parse_qs(parsed.query, keep_blank_values=True).items():
        query[key] = values[0] if len(values) == 1 else values
    return parsed.path or "/", query


def _match_resource_template(template: str, pathname: str) -> Optional[Dict[str, str]]:
    from urllib.parse import unquote

    template_parts = [part for part in template.split("/") if part]
    path_parts = [part for part in pathname.split("/") if part]
    if len(template_parts) != len(path_parts):
        return None
    params: Dict[str, str] = {}
    for template_part, path_part in zip(template_parts, path_parts):
        if template_part.startswith("{") and template_part.endswith("}"):
            params[template_part[1:-1]] = unquote(path_part)
        elif template_part != path_part:
            return None
    return params


def _render_resource_template(template: str, params: Dict[str, Any]) -> str:
    path = template
    for key, value in params.items():
        path = path.replace("{" + key + "}", quote(str(value), safe=""))
    return path


def _append_query(path: str, query: Dict[str, Any]) -> str:
    from urllib.parse import urlencode

    cleaned = {key: value for key, value in query.items() if value is not None}
    return "%s?%s" % (path, urlencode(cleaned, doseq=True)) if cleaned else path


def _compact_rpc_params(params: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, dict) and not value:
            continue
        result[key] = value
    return result
`
}

export function writeGeneratedFiles(model = buildGeneratedModel()): void {
  writeFile(join(ROOT, 'src', 'generated', 'contracts', 'index.ts'), generateTypeScript(model))
  writeFile(join(ROOT, 'src', 'generated', 'modules', 'index.ts'), generateModulesIndex(model))
  writeFile(join(ROOT, 'src', 'generated', 'modules', 'resourceHandlers.ts'), generateResourceHandlers(model))
  writeFile(join(ROOT, 'src', 'generated', 'executors', 'index.ts'), generateExecutors(model))
  writeFile(join(ROOT, 'desktop', 'src', 'generated', 'resources', 'index.ts'), generateDesktopResources(model))
  writeFile(join(ROOT, 'packages', 'sdk-python', 'src', 'beya', 'generated', '__init__.py'), generatePython(model))
}

export function assertGeneratedFilesCurrent(model = buildGeneratedModel()): string[] {
  const expected = new Map([
    [join(ROOT, 'src', 'generated', 'contracts', 'index.ts'), generateTypeScript(model)],
    [join(ROOT, 'src', 'generated', 'modules', 'index.ts'), generateModulesIndex(model)],
    [join(ROOT, 'src', 'generated', 'modules', 'resourceHandlers.ts'), generateResourceHandlers(model)],
    [join(ROOT, 'src', 'generated', 'executors', 'index.ts'), generateExecutors(model)],
    [join(ROOT, 'desktop', 'src', 'generated', 'resources', 'index.ts'), generateDesktopResources(model)],
    [join(ROOT, 'packages', 'sdk-python', 'src', 'beya', 'generated', '__init__.py'), generatePython(model)],
  ])
  const errors: string[] = []
  for (const [file, expectedContent] of expected) {
    const rel = relPath(file)
    if (!existsSync(file)) {
      errors.push(`${rel} is missing; run bun run contracts:generate`)
      continue
    }
    const actual = readFileSync(file, 'utf8')
    if (actual !== expectedContent) {
      errors.push(`${rel} is out of date; run bun run contracts:generate`)
    }
  }
  return errors
}

function validateDocuments<T>(
  label: string,
  documents: LoadedDocument<T>[],
  schemaPath: string,
  errors: string[],
): void {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validate = ajv.compile(schema)
  for (const document of documents) {
    const rel = relPath(document.path)
    if (!validate(document.document)) {
      for (const error of validate.errors ?? []) {
        errors.push(`${rel}: ${label} ${error.instancePath || '/'} ${error.message}`)
      }
    }
  }
}

function validateResourceMethod(
  rel: string,
  method: ContractItem,
  moduleIds: Set<string>,
  moduleResourceMethods: Map<string, string>,
  errors: string[],
): void {
  if (!method.owner) errors.push(`${rel}: resource method ${method.name} must declare owner`)
  if (method.owner && !moduleIds.has(method.owner)) errors.push(`${rel}: method ${method.name} has unknown owner ${method.owner}`)
  const moduleOwner = moduleResourceMethods.get(method.name)
  if (!moduleOwner) {
    errors.push(`${rel}: method ${method.name} is not claimed by any module contract`)
  } else if (method.owner && moduleOwner !== method.owner) {
    errors.push(`${rel}: method ${method.name} owner mismatch: resources=${method.owner}, module=${moduleOwner}`)
  }
  if (!method.request) errors.push(`${rel}: resource method ${method.name} must declare request schema`)
  if (!method.response) errors.push(`${rel}: resource method ${method.name} must declare response schema`)
  if (!method.auth) errors.push(`${rel}: resource method ${method.name} must declare auth policy`)
  if (!method.client) errors.push(`${rel}: resource method ${method.name} must declare client exposure`)
  if (!method.resource?.handler) {
    errors.push(`${rel}: resource method ${method.name} must declare resource.handler`)
  } else {
    validateImplementationBinding(rel, method.resource.handler, errors)
  }
}

function validateImplementationBinding(rel: string, binding: ResourceHandlerBinding, errors: string[]): void {
  const sourcePath = binding.module.startsWith('src/') || binding.module.startsWith('desktop/')
    ? join(ROOT, binding.module.replace(/\.js$/, '.ts'))
    : join(ROOT, binding.module)
  if (binding.module.startsWith('src/generated/') || binding.module.startsWith('desktop/src/generated/')) {
    return
  }
  if (!existsSync(sourcePath)) {
    errors.push(`${rel}: implementation module does not exist: ${binding.module}`)
  }
  if (!binding.export) {
    errors.push(`${rel}: implementation export is required for ${binding.module}`)
  }
}

function collectYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return collectYamlFiles(fullPath)
    return entry.isFile() && /\.ya?ml$/i.test(entry.name) ? [fullPath] : []
  })
}

function writeFile(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content.replace(/\r?\n/g, '\n'), 'utf8')
}

function relPath(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/')
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function sortResourceMethodsForMatching(values: ResourceMethod[]) {
  return [...values].sort((a, b) => {
    const scoreDelta = resourceSpecificityScore(b.path) - resourceSpecificityScore(a.path)
    if (scoreDelta !== 0) return scoreDelta
    return a.name.localeCompare(b.name)
  })
}

function resourceSpecificityScore(path: string): number {
  const parts = path.split('/').filter(Boolean)
  const staticCount = parts.filter((part) => !/^\{.+\}$/.test(part)).length
  const paramCount = parts.length - staticCount
  return staticCount * 100 + parts.length * 10 - paramCount
}

function tsArray(values: string[]): string {
  return `[${values.map((value) => `'${value}'`).join(', ')}]`
}

function tsRegistry(values: ResourceMethod[]): string {
  const entries = values.map((entry) =>
    `  '${entry.name}': { httpMethod: '${entry.httpMethod}', path: '${entry.path}', owner: '${entry.owner}', auth: '${entry.auth}', clientName: '${entry.clientName}' },`,
  )
  return `{\n${entries.join('\n')}\n}`
}

function pyTuple(values: string[]): string {
  if (values.length === 1) return `("${values[0]}",)`
  return `(${values.map((value) => `"${value}"`).join(', ')})`
}

function pyRegistry(values: ResourceMethod[]): string {
  const entries = values.map((entry) =>
    `    "${entry.name}": {"httpMethod": "${entry.httpMethod}", "path": "${entry.path}", "owner": "${entry.owner}", "auth": "${entry.auth}", "clientName": "${entry.clientName}"},`,
  )
  return `{\n${entries.join('\n')}\n}`
}

function pyLiteralTuple(values: string[]): string {
  return `[${values.map((value) => `"${value}"`).join(', ')}]`
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function toClientName(methodName: string): string {
  const [domain, action] = methodName.split('.')
  return `${domain}${(action ?? '').slice(0, 1).toUpperCase()}${(action ?? '').slice(1)}`
}

function groupResourceMethodsByOwner(values: ResourceMethod[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const value of values) {
    grouped[value.owner] = [...(grouped[value.owner] ?? []), value.name]
  }
  return Object.fromEntries(
    Object.entries(grouped).map(([key, methods]) => [key, methods.sort()]),
  )
}

function groupResourceMethodsByDomain(values: ResourceMethod[]): Record<string, ResourceMethod[]> {
  const grouped: Record<string, ResourceMethod[]> = {}
  for (const value of values) {
    const domain = value.name.split('.')[0]!
    grouped[domain] = [...(grouped[domain] ?? []), value]
  }
  return Object.fromEntries(
    Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)),
  )
}

function uniqueHandlers(values: ResourceMethod[]): ResourceHandlerBinding[] {
  const seen = new Map<string, ResourceHandlerBinding>()
  for (const value of values) {
    const key = `${value.handler.module}:${value.handler.export}`
    if (!seen.has(key)) seen.set(key, value.handler)
  }
  return [...seen.values()].sort((a, b) => `${a.module}:${a.export}`.localeCompare(`${b.module}:${b.export}`))
}

function uniqueSegmentHandlers(values: ResourceMethod[]): Array<{ segment: string; handler: ResourceHandlerBinding }> {
  const bySegment = new Map<string, ResourceHandlerBinding>()
  for (const value of values) {
    const segment = firstStaticSegment(value.path)
    if (!segment || bySegment.has(segment)) continue
    bySegment.set(segment, value.handler)
  }
  return [...bySegment.entries()]
    .map(([segment, handler]) => ({ segment, handler }))
    .sort((a, b) => a.segment.localeCompare(b.segment))
}

function firstStaticSegment(path: string): string | null {
  return path.split('/').filter(Boolean).find((part) => !part.startsWith('{')) ?? null
}

function relativeImport(fromFile: string, targetModule: string): string {
  const fromDir = dirname(join(ROOT, fromFile))
  const target = join(ROOT, targetModule)
  let rel = relative(fromDir, target).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  if (!extname(rel)) rel = `${rel}.js`
  return rel
}
