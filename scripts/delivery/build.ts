import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { PROVIDER_CATALOG } from '../../src/server/config/providerCatalog.js'

const root = process.cwd()
const outputRoot = join(root, 'dist', 'delivery')
const gatewayDir = join(outputRoot, 'beya-gateway')
const sdkDir = join(outputRoot, 'beya-sdk-python')
const python = resolvePython()
const gatewayExecutableName = 'beya-gateway'

await rm(outputRoot, { recursive: true, force: true })
await mkdir(gatewayDir, { recursive: true })
await mkdir(sdkDir, { recursive: true })

const optionalExternals = [
  '@anthropic-ai/bedrock-sdk',
  '@anthropic-ai/foundry-sdk',
  '@anthropic-ai/mcpb',
  '@anthropic-ai/vertex-sdk',
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-sts',
  '@azure/identity',
  '@opentelemetry/exporter-logs-otlp-grpc',
  '@opentelemetry/exporter-logs-otlp-http',
  '@opentelemetry/exporter-logs-otlp-proto',
  '@opentelemetry/exporter-metrics-otlp-grpc',
  '@opentelemetry/exporter-metrics-otlp-http',
  '@opentelemetry/exporter-metrics-otlp-proto',
  '@opentelemetry/exporter-prometheus',
  '@opentelemetry/exporter-trace-otlp-grpc',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-trace-otlp-proto',
  'fflate',
  'sharp',
]

const linuxBunExecutable = await resolveLinuxBunExecutable()

run('bun', [
  'build',
  join(root, 'src', 'gateway', 'server.ts'),
  '--compile',
  '--target=bun-linux-x64',
  `--compile-executable-path=${linuxBunExecutable}`,
  ...optionalExternals.flatMap(pkg => ['--external', pkg]),
  '--outfile',
  join(gatewayDir, gatewayExecutableName),
])

await writeGatewayFiles()
await assertGatewayExecutableProduced()
await buildPythonSdk()

console.log(`Delivery artifacts written to ${outputRoot}`)

async function writeGatewayFiles() {
  await writeFile(
    join(gatewayDir, 'package.json'),
    `${JSON.stringify({
      name: '@beya/gateway-blackbox',
      version: '0.1.0',
      private: true,
      scripts: {
        start: './beya-gateway',
        healthcheck: 'python healthcheck.py',
      },
    }, null, 2)}\n`,
    'utf-8',
  )
  await writeFile(
    join(gatewayDir, 'provider-catalog.json'),
    `${JSON.stringify(PROVIDER_CATALOG, null, 2)}\n`,
    'utf-8',
  )
  await writeFile(
    join(gatewayDir, 'plugin-schema.json'),
    `${JSON.stringify({
      name: 'Beya Gateway plugin contract',
      plugin: {
        name: 'string',
        description: 'string?',
        skills: ['SkillDefinition | string'],
        tools: ['ToolDefinition'],
        mcpServers: 'Beya MCP server config map',
      },
      skill: {
        name: 'string',
        description: 'string',
        content: 'SKILL.md markdown',
        allowedTools: ['tool name'],
      },
      tool: {
        name: 'string',
        description: 'string',
        inputSchema: 'JSON Schema object',
        executor: {
          type: 'http',
          url: 'string',
          method: 'POST',
          headers: 'record<string,string>',
          toolName: 'string?',
          namespace: 'string?',
        },
        annotations: {
          readOnlyHint: 'boolean',
          destructiveHint: 'boolean',
          openWorldHint: 'boolean',
        },
      },
    }, null, 2)}\n`,
    'utf-8',
  )
  await writeFile(
    join(gatewayDir, 'start-gateway.sh'),
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'SERVER_HOST="${SERVER_HOST:-127.0.0.1}"',
      'SERVER_PORT="${SERVER_PORT:-3456}"',
      'exec "$(dirname "$0")/beya-gateway" --host "$SERVER_HOST" --port "$SERVER_PORT"',
      '',
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(gatewayDir, 'healthcheck.py'),
    [
      'import json',
      'import os',
      'import sys',
      'import urllib.request',
      '',
      'host = os.environ.get("SERVER_HOST", "127.0.0.1")',
      'port = os.environ.get("SERVER_PORT", "3456")',
      'with urllib.request.urlopen("http://%s:%s/health" % (host, port), timeout=5) as response:',
      '    body = json.loads(response.read().decode("utf-8"))',
      'if body.get("status") != "ok":',
      '    sys.exit(1)',
      'print(json.dumps(body))',
      '',
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(gatewayDir, 'README_DELIVERY.md'),
    [
      '# Beya Gateway Blackbox',
      '',
      'This package contains the standalone Linux x64 Beya Gateway executable. It exposes `/api/*`, `/v1/*`, `/health`, and `/readiness`.',
      '',
      'Required runtime:',
      '- `BEYA_CONFIG_DIR` points to a writable deployment-local config directory.',
      '- `SERVER_HOST` and `SERVER_PORT` select the internal listen address.',
      '',
      'Start:',
      '- Linux: `chmod +x beya-gateway && sh start-gateway.sh`.',
      '',
      'This artifact intentionally does not include TypeScript source files or a JavaScript Gateway bundle.',
      '',
    ].join('\n'),
    'utf-8',
  )
}

async function assertGatewayExecutableProduced() {
  const executablePath = join(gatewayDir, gatewayExecutableName)
  if (!existsSync(executablePath)) {
    throw new Error(`Gateway executable was not produced: ${executablePath}`)
  }
  const header = await readFile(executablePath)
  if (header.length < 4 || header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
    throw new Error(`Gateway executable is not a Linux ELF binary: ${executablePath}`)
  }
}

async function buildPythonSdk() {
  const packageDir = join(root, 'packages', 'sdk-python')
  const wheelhouse = join(sdkDir, 'wheelhouse')
  await cleanupPythonBuildArtifacts(packageDir)
  await mkdir(wheelhouse, { recursive: true })
  run(python, [
    '-m',
    'pip',
    'wheel',
    packageDir,
    '--no-deps',
    '--wheel-dir',
    wheelhouse,
  ], { shell: false })
  run(python, [
    '-m',
    'pip',
    'download',
    packageDir,
    '--no-deps',
    '--no-binary',
    ':all:',
    '--dest',
    wheelhouse,
  ], { shell: false, allowFailure: true })
  await copyIfExists(join(packageDir, 'README.md'), join(sdkDir, 'README.md'))
  await writeFile(
    join(sdkDir, 'install.cmd'),
    [
      '@echo off',
      'setlocal',
      'python -m pip install --no-index --find-links "%~dp0wheelhouse" beya-sdk',
      '',
    ].join('\r\n'),
    'utf-8',
  )
  await writeFile(
    join(sdkDir, 'install.sh'),
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'python -m pip install --no-index --find-links "$(dirname "$0")/wheelhouse" beya-sdk',
      '',
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(sdkDir, 'README_DELIVERY.md'),
    [
      '# Beya Python SDK',
      '',
      'Install from the local wheelhouse:',
      '- Windows: `install.cmd`',
      '- Linux: `sh install.sh`',
      '',
      'Basic usage:',
      '```python',
      'from beya import BeyaClient',
      'client = BeyaClient(base_url="http://ai-service:8000", api_key="...")',
      'for event in client.chat.stream("hello"):',
      '    print(event)',
      '```',
      '',
    ].join('\n'),
    'utf-8',
  )
  const wheels = await readdir(wheelhouse)
  if (!wheels.some(name => name.endsWith('.whl'))) {
    throw new Error('Python SDK wheel was not produced')
  }
  await cleanupPythonBuildArtifacts(packageDir)
}

async function resolveLinuxBunExecutable(): Promise<string> {
  const configured = process.env.BEYA_LINUX_BUN_EXECUTABLE
  if (configured && existsSync(configured)) {
    return configured
  }

  const installRoot = join(outputRoot, '.tmp-bun-linux')
  await rm(installRoot, { recursive: true, force: true })
  await mkdir(installRoot, { recursive: true })
  const registry =
    process.env.BEYA_NPM_REGISTRY ||
    process.env.NPM_CONFIG_REGISTRY ||
    process.env.NPM_REGISTRY ||
    'https://mirrors.huaweicloud.com/repository/npm'
  run('npm', [
    'install',
    '--prefix',
    installRoot,
    '@oven/bun-linux-x64@1.3.14',
    '--registry',
    registry,
    '--no-audit',
    '--no-fund',
    '--force',
  ])
  const executablePath = join(installRoot, 'node_modules', '@oven', 'bun-linux-x64', 'bin', 'bun')
  if (!existsSync(executablePath)) {
    throw new Error(`Linux Bun executable was not installed: ${executablePath}`)
  }
  return executablePath
}

async function cleanupPythonBuildArtifacts(packageDir: string) {
  await rm(join(packageDir, 'build'), { recursive: true, force: true })
  await rm(join(packageDir, 'src', 'beya_sdk.egg-info'), { recursive: true, force: true })
  await rm(join(packageDir, 'src', 'beya', '__pycache__'), { recursive: true, force: true })
  await rm(join(packageDir, 'tests', '__pycache__'), { recursive: true, force: true })
}

async function copyIfExists(source: string, target: string) {
  if (existsSync(source)) {
    await copyFile(source, target)
  }
}

type RunOptions = {
  shell?: boolean
  allowFailure?: boolean
}

function run(command: string, args: string[], options: RunOptions = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: options.allowFailure ? 'pipe' : 'inherit',
    shell: options.shell ?? process.platform === 'win32',
  })
  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status ?? 1)
  }
}

function resolvePython(): string {
  const bundled = join(
    process.env.USERPROFILE || '',
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'python',
    process.platform === 'win32' ? 'python.exe' : 'bin/python',
  )
  const candidates = [
    process.env.PYTHON,
    'python',
    bundled,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], {
      cwd: root,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    })
    if (result.status === 0) return candidate
  }

  throw new Error('No Python executable found. Set PYTHON to build delivery artifacts.')
}
