import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

type Rule = {
  id: string
  description: string
  pattern: RegExp
  include: (path: string) => boolean
  allow?: (path: string, line: string) => boolean
}

type Violation = {
  rule: string
  description: string
  path: string
  line: number
  text: string
}

const ROOT = process.cwd()
const ignoredDirs = new Set([
  '.git',
  '.omx',
  'node_modules',
  'target',
  'dist',
  'build',
  'coverage',
  'artifacts',
])

const textExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.py',
  '.md',
])

const negativeRouteTests = new Set([
  'tests/beyaServerSdkContract.test.ts',
  'src/server/__tests__/rpc-gateway.test.ts',
  'src/server/__tests__/session-ws-path.test.ts',
])

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function hasTextExtension(path: string): boolean {
  return [...textExtensions].some((ext) => path.endsWith(ext))
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    const rel = normalizePath(relative(ROOT, abs))
    const stat = statSync(abs)
    if (stat.isDirectory()) {
      if (!ignoredDirs.has(entry) && !rel.endsWith('/node_modules')) {
        collectFiles(abs, out)
      }
      continue
    }
    if (stat.isFile() && hasTextExtension(entry)) out.push(rel)
  }
  return out
}

function inAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

function isThirdPartySdkLine(line: string): boolean {
  return line.includes('@anthropic-ai/sdk') || line.includes('@modelcontextprotocol/sdk')
}

function isAllowedNegativeTest(path: string): boolean {
  return negativeRouteTests.has(path)
}

const criticalSurfaces = [
  'contracts',
  'src/generated',
  'packages/sdk-python/src/beya/generated',
  'src/server/ws',
  'src/server/router.ts',
  'desktop/src/api',
  'desktop/src/stores/chatStore.ts',
  'desktop/src/types/chat.ts',
  'packages/sdk-python/src/beya/client.py',
  'adapters',
  'tests/startBeyaWebSmoke.test.ts',
]

const rules: Rule[] = [
  {
    id: 'removed-resources-request',
    description: 'resources.request is removed; RPC must use explicit contract methods.',
    pattern: /\bresources\.request\b/g,
    include: (path) => inAny(path, ['contracts', 'src/generated', 'packages/sdk-python/src/beya/generated', 'src/server', 'desktop/src', 'packages/sdk-python/src/beya', 'adapters', 'tests']),
    allow: (path) => path === 'src/server/__tests__/rpc-gateway.test.ts',
  },
  {
    id: 'removed-sdk-url-arg',
    description: '--sdk-url is removed; runtime bridge startup must use --runtime-url.',
    pattern: /--sdk-url/g,
    include: (path) => inAny(path, ['contracts', 'src', 'tests']),
  },
  {
    id: 'wire-type-field',
    description: 'Contracts are contract-native; wireType fields are not allowed.',
    pattern: /\bwireType\b/g,
    include: (path) => inAny(path, ['contracts', 'scripts/contracts']),
  },
  {
    id: 'old-app-rpc-name',
    description: 'App WebSocket RPC naming is retired; use Resource/Beya RPC naming.',
    pattern: /App WebSocket RPC|buildAppWebSocketUrl/g,
    include: (path) => inAny(path, ['desktop/src', 'tests', 'src/server']),
  },
  {
    id: 'old-public-ws-app-path',
    description: '/ws/app is removed; public resource RPC is /rpc.',
    pattern: /\/ws\/app/g,
    include: (path) => inAny(path, ['contracts', 'src', 'desktop/src', 'packages/sdk-python/src/beya', 'adapters', 'tests']),
    allow: (path) => isAllowedNegativeTest(path),
  },
  {
    id: 'old-public-runtime-path',
    description: '/sdk/{sessionId} is removed; runtime bridge is /sessions/{sessionId}/runtime.',
    pattern: /(^|['"`\s])\/sdk\//g,
    include: (path) => inAny(path, ['contracts', 'src', 'desktop/src', 'packages/sdk-python/src/beya', 'adapters', 'tests']),
    allow: (path, line) => isAllowedNegativeTest(path) || isThirdPartySdkLine(line),
  },
  {
    id: 'client-api-resource-path',
    description: 'Resource clients must not construct local /api resource paths.',
    pattern: /(['"`]\/api(?:\/|['"`])|\$\{[^}]+}\s*\/api\/)/g,
    include: (path) => inAny(path, criticalSurfaces),
    allow: (path) => isAllowedNegativeTest(path),
  },
  {
    id: 'old-session-wire-type',
    description: 'Session transport must use canonical session.* message names.',
    pattern: /(case\s+['"`](connected|status|content_start|content_delta|tool_use_complete|message_complete|permission_request|computer_use_permission_request|api_retry|team_update|task_update|session_title_updated|system_notification|error)['"`]|type:\s*['"`](user_message|permission_response|computer_use_permission_response|set_runtime_config|set_permission_mode|prewarm_session|stop_generation)['"`])/g,
    include: (path) => inAny(path, ['src/server/ws', 'desktop/src/stores/chatStore.ts', 'desktop/src/api/websocket.ts', 'adapters']),
  },
  {
    id: 'manual-resource-router-switch',
    description: 'Resource routing must be generated from contracts, not a hand-written router switch.',
    pattern: /(switch\s*\(\s*resource\s*\)|case\s+['"`][a-z0-9-]+['"`]\s*:)/g,
    include: (path) => path === 'src/server/router.ts',
  },
  {
    id: 'old-contract-architecture-directory',
    description: 'Architecture contracts must live under contracts/modules, contracts/capabilities, or contracts/executors.',
    pattern: /contracts\/(access_surfaces|agent_core|session_host|capability_registry|model_runtime|foundation)\//g,
    include: (path) => inAny(path, ['contracts', 'docs', 'architecture-diagrams.md']),
  },
]

const violations: Violation[] = []

for (const path of collectFiles(ROOT)) {
  const text = readFileSync(join(ROOT, path), 'utf8')
  const lines = text.split(/\r?\n/)
  for (const rule of rules) {
    if (!rule.include(path)) continue
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      rule.pattern.lastIndex = 0
      if (!rule.pattern.test(line)) continue
      if (rule.allow?.(path, line)) continue
      violations.push({
        rule: rule.id,
        description: rule.description,
        path,
        line: index + 1,
        text: line.trim(),
      })
    }
  }
}

if (violations.length > 0) {
  console.error(`Architecture residue check failed with ${violations.length} violation(s):`)
  for (const violation of violations.slice(0, 200)) {
    console.error(`${violation.path}:${violation.line} [${violation.rule}] ${violation.text}`)
  }
  if (violations.length > 200) {
    console.error(`...and ${violations.length - 200} more violation(s).`)
  }
  process.exit(1)
}

console.log('Architecture residue check passed.')
