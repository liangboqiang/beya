import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { PROVIDER_CATALOG } from '../../src/server/config/providerCatalog.js'

const root = process.cwd()
const outputRoot = join(root, 'dist', 'beya-sdk')
const serverDir = join(outputRoot, 'server')
const serverWinDir = join(serverDir, 'win-x64')
const pythonDir = join(outputRoot, 'python')
const contractsDir = join(outputRoot, 'contracts')
const examplesDir = join(outputRoot, 'examples')
const scriptsDir = join(outputRoot, 'scripts')
const python = resolvePython()
const serverExecutableName = 'beya-server'

await rm(outputRoot, { recursive: true, force: true })
await mkdir(serverDir, { recursive: true })
await mkdir(serverWinDir, { recursive: true })
await mkdir(pythonDir, { recursive: true })
await mkdir(contractsDir, { recursive: true })
await mkdir(examplesDir, { recursive: true })
await mkdir(scriptsDir, { recursive: true })

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

compileServer({
  target: 'bun-linux-x64',
  outfile: join(serverDir, serverExecutableName),
  executablePath: linuxBunExecutable,
})
compileServer({
  target: 'bun-windows-x64',
  outfile: join(serverWinDir, 'beya-server.exe'),
  executablePath: resolveWindowsBunExecutable(),
})

await writeServerFiles()
await writeContracts()
await writeExamples()
await writePackageScripts()
await assertServerExecutableProduced()
await buildPythonSdk()
await rm(join(outputRoot, '.tmp-bun-linux'), { recursive: true, force: true })

console.log(`Delivery artifacts written to ${outputRoot}`)

async function writeServerFiles() {
  await writeFile(
    join(serverDir, 'package.json'),
    `${JSON.stringify({
      name: 'beya-server',
      version: '0.1.0',
      private: true,
      scripts: {
        start: './beya-server',
        healthcheck: 'python healthcheck.py',
      },
    }, null, 2)}\n`,
    'utf-8',
  )
  await writeFile(
    join(serverDir, 'provider-catalog.json'),
    `${JSON.stringify(PROVIDER_CATALOG, null, 2)}\n`,
    'utf-8',
  )
  await writeFile(
    join(serverDir, 'plugin-schema.json'),
    `${JSON.stringify(pluginContractSchema(), null, 2)}\n`,
    'utf-8',
  )
  await writeFile(
    join(serverDir, 'start.sh'),
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'SERVER_HOST="${SERVER_HOST:-127.0.0.1}"',
      'SERVER_PORT="${SERVER_PORT:-3456}"',
      'exec "$(dirname "$0")/beya-server" --host "$SERVER_HOST" --port "$SERVER_PORT"',
      '',
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(serverWinDir, 'start.cmd'),
    [
      '@echo off',
      'setlocal',
      'if "%SERVER_HOST%"=="" set "SERVER_HOST=127.0.0.1"',
      'if "%SERVER_PORT%"=="" set "SERVER_PORT=3456"',
      '"%~dp0beya-server.exe" --host "%SERVER_HOST%" --port "%SERVER_PORT%"',
      '',
    ].join('\r\n'),
    'utf-8',
  )
  await writeFile(
    join(serverDir, 'healthcheck.py'),
    [
      'import json',
      'import os',
      'import sys',
      'import urllib.request',
      '',
      'host = os.environ.get("SERVER_HOST", "127.0.0.1")',
      'port = os.environ.get("SERVER_PORT", "3456")',
      'with urllib.request.urlopen("http://%s:%s/api/health" % (host, port), timeout=5) as response:',
      '    body = json.loads(response.read().decode("utf-8"))',
      'if body.get("status") != "ok":',
      '    sys.exit(1)',
      'print(json.dumps(body))',
      '',
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(serverDir, 'README.md'),
    [
      '# Beya Server',
      '',
      'This package contains the standalone Linux x64 Beya Server executable. It exposes only `/api/*`.',
      'The Windows x64 executable is under `win-x64/beya-server.exe`.',
      '',
      'Required runtime:',
      '- `BEYA_CONFIG_DIR` points to a writable deployment-local config directory.',
      '- `SERVER_HOST` and `SERVER_PORT` select the internal listen address.',
      '',
      'Start:',
      '- Linux: `chmod +x beya-server && sh start.sh`.',
      '- Windows: `cd win-x64 && start.cmd`.',
      '',
      'Health:',
      '- `GET /api/health`',
      '- `GET /api/readiness`',
      '',
      'This artifact intentionally does not include TypeScript source files or a JavaScript server bundle.',
      '',
    ].join('\n'),
    'utf-8',
  )
}

async function assertServerExecutableProduced() {
  const executablePath = join(serverDir, serverExecutableName)
  if (!existsSync(executablePath)) {
    throw new Error(`Beya Server executable was not produced: ${executablePath}`)
  }
  const header = await readFile(executablePath)
  if (header.length < 4 || header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
    throw new Error(`Beya Server executable is not a Linux ELF binary: ${executablePath}`)
  }
  const windowsExecutablePath = join(serverWinDir, 'beya-server.exe')
  if (!existsSync(windowsExecutablePath)) {
    throw new Error(`Windows Beya Server executable was not produced: ${windowsExecutablePath}`)
  }
  const windowsHeader = await readFile(windowsExecutablePath)
  if (windowsHeader.length < 2 || windowsHeader[0] !== 0x4d || windowsHeader[1] !== 0x5a) {
    throw new Error(`Beya Server executable is not a Windows PE binary: ${windowsExecutablePath}`)
  }
}

async function writeContracts() {
  const schemasDir = join(contractsDir, 'schemas')
  await mkdir(schemasDir, { recursive: true })
  await writeFile(
    join(contractsDir, 'openapi.yaml'),
    [
      'openapi: 3.1.0',
      'info:',
      '  title: Beya SDK API',
      '  version: 0.1.0',
      'servers:',
      '  - url: http://127.0.0.1:3456',
      'paths:',
      '  /api/health:',
      '    get:',
      '      summary: Beya Server health check',
      '      responses:',
      '        "200": { description: OK }',
      '  /api/readiness:',
      '    get:',
      '      summary: Beya Server readiness check',
      '      responses:',
      '        "200": { description: Ready }',
      '  /api/tasks:',
      '    get:',
      '      summary: List tasks',
      '      responses:',
      '        "200": { description: Task list }',
      '    post:',
      '      summary: Submit a task',
      '      responses:',
      '        "201": { description: Task handle }',
      '  /api/tasks/{task_id}/stream:',
      '    get:',
      '      summary: Stream task events as SSE',
      '      parameters:',
      '        - { name: task_id, in: path, required: true, schema: { type: string } }',
      '      responses:',
      '        "200": { description: Event stream }',
      '  /api/plugins:',
      '    get:',
      '      summary: List installed plugins',
      '      responses:',
      '        "200": { description: Plugin list }',
      '    post:',
      '      summary: Install or register a plugin',
      '      responses:',
      '        "200": { description: Plugin detail }',
      '  /api/models:',
      '    get:',
      '      summary: List available models',
      '      responses:',
      '        "200": { description: Model list }',
      '  /api/providers:',
      '    get:',
      '      summary: List model providers',
      '      responses:',
      '        "200": { description: Provider list }',
      '  /api/openai/chat/completions:',
      '    post:',
      '      summary: OpenAI-shaped SDK helper backed by Beya tasks',
      '      responses:',
      '        "200": { description: Chat completion }',
      '',
    ].join('\n'),
    'utf-8',
  )
  const schemas: Record<string, unknown> = {
    'task-event.schema.json': taskEventSchema(),
    'plugin.schema.json': pluginContractSchema(),
    'tool.schema.json': toolContractSchema(),
    'skill.schema.json': skillContractSchema(),
    'provider.schema.json': providerContractSchema(),
    'diagnostics.schema.json': diagnosticsContractSchema(),
  }
  for (const [name, schema] of Object.entries(schemas)) {
    await writeFile(join(schemasDir, name), `${JSON.stringify(schema, null, 2)}\n`, 'utf-8')
  }
}

async function writeExamples() {
  const pythonExamples = join(examplesDir, 'python')
  const pluginExamples = join(examplesDir, 'plugins')
  await mkdir(pythonExamples, { recursive: true })
  await mkdir(pluginExamples, { recursive: true })
  await writeFile(
    join(pythonExamples, 'chat.py'),
    [
      'from beya import BeyaClient',
      '',
      'client = BeyaClient(base_url="http://127.0.0.1:3456")',
      'result = client.chat.run("hello")',
      'print(result.result)',
      '',
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(pythonExamples, 'stream_task.py'),
    [
      'from beya import BeyaClient',
      '',
      'client = BeyaClient(base_url="http://127.0.0.1:3456")',
      'handle = client.tasks.submit("hello")',
      'for event in client.tasks.stream(handle.task_id):',
      '    print(event.type, event.message)',
      '',
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(pythonExamples, 'install_plugin.py'),
    [
      'from beya import BeyaClient, RemoteToolExecutor, define_plugin, define_skill, define_tool',
      '',
      'tool = define_tool(',
      '    name="remote_echo",',
      '    description="Echo through a remote tool executor",',
      '    input_schema={"type": "object", "properties": {"message": {"type": "string"}}},',
      '    executor=RemoteToolExecutor(url="http://127.0.0.1:8000/internal/tools/execute"),',
      '    annotations={"readOnlyHint": True},',
      ')',
      'skill = define_skill(',
      '    name="echo_skill",',
      '    description="Use the echo tool",',
      '    content="Use remote_echo when the user asks for an echo.",',
      '    allowed_tools=["remote_echo"],',
      ')',
      'plugin = define_plugin(name="remote-tools-plugin", description="Remote tool example", tools=[tool], skills=[skill])',
      '',
      'client = BeyaClient(base_url="http://127.0.0.1:3456")',
      'print(client.plugins.install(plugin))',
      '',
    ].join('\n'),
    'utf-8',
  )
}

async function writePackageScripts() {
  await writeFile(
    join(scriptsDir, 'start-server.sh'),
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'exec "$(dirname "$0")/../server/start.sh"',
      '',
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(scriptsDir, 'verify-package.py'),
    [
      'from pathlib import Path',
      'import sys',
      '',
      'root = Path(__file__).resolve().parents[1]',
      'required = [',
      '    root / "server" / "beya-server",',
      '    root / "server" / "healthcheck.py",',
      '    root / "python" / "wheelhouse",',
      '    root / "contracts" / "openapi.yaml",',
      '    root / "contracts" / "schemas" / "plugin.schema.json",',
      ']',
      'missing = [str(path.relative_to(root)) for path in required if not path.exists()]',
      'if missing:',
      '    print("missing: " + ", ".join(missing))',
      '    sys.exit(1)',
      'bad = []',
      'for path in root.rglob("*"):',
      '    if path.is_file() and path.suffix in {".ts", ".tsx", ".map"}:',
      '        bad.append(str(path.relative_to(root)))',
      'if bad:',
      '    print("unexpected source files: " + ", ".join(bad[:20]))',
      '    sys.exit(1)',
      'print("beya-sdk package verified")',
      '',
    ].join('\n'),
    'utf-8',
  )
}

async function buildPythonSdk() {
  const packageDir = join(root, 'packages', 'sdk-python')
  const wheelhouse = join(pythonDir, 'wheelhouse')
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
  await copyIfExists(join(packageDir, 'README.md'), join(pythonDir, 'README.md'))
  await writeFile(
    join(pythonDir, 'install.cmd'),
    [
      '@echo off',
      'setlocal',
      'python -m pip install --no-index --find-links "%~dp0wheelhouse" beya-sdk',
      '',
    ].join('\r\n'),
    'utf-8',
  )
  await writeFile(
    join(pythonDir, 'install.sh'),
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'python -m pip install --no-index --find-links "$(dirname "$0")/wheelhouse" beya-sdk',
      '',
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(pythonDir, 'README_DELIVERY.md'),
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

function pluginContractSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Beya plugin',
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      version: { type: 'string' },
      skills: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      tools: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      resources: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      mcpServers: { type: 'object', additionalProperties: true },
    },
    additionalProperties: true,
  }
}

function toolContractSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Beya SDK plugin tool',
    type: 'object',
    required: ['name', 'description'],
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      inputSchema: { type: 'object' },
      executor: {
        type: 'object',
        required: ['type', 'url'],
        properties: {
          type: { const: 'http' },
          url: { type: 'string' },
          method: { const: 'POST' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          toolName: { type: 'string' },
          namespace: { type: 'string' },
        },
      },
      annotations: {
        type: 'object',
        properties: {
          readOnlyHint: { type: 'boolean' },
          destructiveHint: { type: 'boolean' },
          openWorldHint: { type: 'boolean' },
        },
      },
      searchHint: { type: 'string' },
      alwaysLoad: { type: 'boolean' },
    },
    additionalProperties: true,
  }
}

function skillContractSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Beya SDK plugin skill',
    type: 'object',
    required: ['name', 'description', 'content'],
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      content: { type: 'string', minLength: 1 },
      whenToUse: { type: 'string' },
      allowedTools: { type: 'array', items: { type: 'string' } },
      argumentHint: { type: 'string' },
      model: { type: 'string' },
      userInvocable: { type: 'boolean' },
    },
    additionalProperties: false,
  }
}

function taskEventSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Beya task event',
    type: 'object',
    required: ['type', 'task_id', 'workflow_id', 'session_id', 'timestamp', 'seq', 'message'],
    properties: {
      type: {
        enum: [
          'TASK_STARTED',
          'LLM_PARTIAL',
          'AGENT_THINKING',
          'TOOL_INVOKED',
          'TOOL_OBSERVATION',
          'APPROVAL_REQUESTED',
          'WORKFLOW_COMPLETED',
          'WORKFLOW_FAILED',
          'WORKFLOW_CANCELLED',
          'done',
        ],
      },
      task_id: { type: 'string' },
      workflow_id: { type: 'string' },
      session_id: { type: 'string' },
      timestamp: { type: 'string' },
      seq: { type: 'integer' },
      stream_id: { type: 'string' },
      message: { type: 'string' },
      payload: { type: 'object' },
      result: { type: 'string' },
      error: { type: 'string' },
    },
    additionalProperties: true,
  }
}

function providerContractSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Beya provider connection',
    type: 'object',
    required: ['providerId', 'displayName', 'baseUrl', 'apiFormat', 'modelRoles'],
    properties: {
      providerId: { type: 'string' },
      displayName: { type: 'string' },
      apiKey: { type: 'string' },
      baseUrl: { type: 'string' },
      apiFormat: { enum: ['openai_chat', 'openai_responses', 'anthropic'] },
      authStrategy: { type: 'string' },
      modelRoles: { type: 'object', additionalProperties: { type: 'string' } },
      enabledModels: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: true,
  }
}

function diagnosticsContractSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Beya diagnostic event',
    type: 'object',
    required: ['type', 'summary', 'severity'],
    properties: {
      type: { type: 'string' },
      summary: { type: 'string' },
      severity: { enum: ['info', 'warning', 'error'] },
      timestamp: { type: 'string' },
      details: { type: 'object' },
    },
    additionalProperties: true,
  }
}

type RunOptions = {
  shell?: boolean
  allowFailure?: boolean
}

function compileServer(options: { target: string, outfile: string, executablePath?: string }) {
  run('bun', [
    'build',
    join(root, 'src', 'server', 'index.ts'),
    '--compile',
    `--target=${options.target}`,
    ...(options.executablePath ? [`--compile-executable-path=${options.executablePath}`] : []),
    ...optionalExternals.flatMap(pkg => ['--external', pkg]),
    '--outfile',
    options.outfile,
  ])
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

function resolveWindowsBunExecutable(): string | undefined {
  const configured = process.env.BEYA_WINDOWS_BUN_EXECUTABLE
  if (configured && existsSync(configured)) {
    return configured
  }
  return undefined
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
