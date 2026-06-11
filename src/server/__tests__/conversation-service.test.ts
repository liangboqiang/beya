import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  ConversationService,
  DESKTOP_CLI_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
} from '../services/conversationService.js'
import { ProviderService } from '../services/providerService.js'
import { resetTerminalShellEnvironmentCacheForTests } from '../../utils/terminalShellEnvironment.js'
import {
  ensureEmbeddedCliMacroFallback,
  extractEmbeddedCliArgs,
} from '../embeddedCli.js'

describe('ConversationService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalApiKey: string | undefined
  let originalAuthToken: string | undefined
  let originalBaseUrl: string | undefined
  let originalModel: string | undefined
  let originalEntrypoint: string | undefined
  let originalOAuthToken: string | undefined
  let originalProviderManagedByHost: string | undefined
  let originalDiagnosticsFile: string | undefined
  let originalAttributionHeader: string | undefined
  let originalHome: string | undefined
  let originalPath: string | undefined
  let originalShell: string | undefined
  let originalZdotdir: string | undefined
  let originalDisableTerminalShellEnv: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beya-conversation-service-'))
    originalConfigDir = process.env.BEYA_CONFIG_DIR
    originalApiKey = process.env.ANTHROPIC_API_KEY
    originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL
    originalModel = process.env.ANTHROPIC_MODEL
    originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    originalOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    originalProviderManagedByHost = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    originalDiagnosticsFile = process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
    originalAttributionHeader = process.env.CLAUDE_CODE_ATTRIBUTION_HEADER
    originalHome = process.env.HOME
    originalPath = process.env.PATH
    originalShell = process.env.SHELL
    originalZdotdir = process.env.ZDOTDIR
    originalDisableTerminalShellEnv = process.env.BEYA_DISABLE_TERMINAL_SHELL_ENV

    process.env.BEYA_CONFIG_DIR = tmpDir
    process.env.ANTHROPIC_API_KEY = 'stale-parent-api-key'
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token'
    process.env.ANTHROPIC_BASE_URL = 'https://example.invalid/anthropic'
    process.env.ANTHROPIC_MODEL = 'test-model'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'inherited-parent-oauth-token'
    // Clear inherited CLAUDE_CODE_ENTRYPOINT so tests can assert whether
    // buildChildEnv injects it or not without interference from the shell env.
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    delete process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
    delete process.env.CLAUDE_CODE_ATTRIBUTION_HEADER
    process.env.BEYA_DISABLE_TERMINAL_SHELL_ENV = '1'
    resetTerminalShellEnvironmentCacheForTests()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.BEYA_CONFIG_DIR
    else process.env.BEYA_CONFIG_DIR = originalConfigDir

    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalApiKey

    if (originalAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken

    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl

    if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL
    else process.env.ANTHROPIC_MODEL = originalModel

    if (originalEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint

    if (originalOAuthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOAuthToken

    if (originalProviderManagedByHost === undefined) delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    else process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = originalProviderManagedByHost

    if (originalDiagnosticsFile === undefined) delete process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
    else process.env.CLAUDE_CODE_DIAGNOSTICS_FILE = originalDiagnosticsFile

    if (originalAttributionHeader === undefined) delete process.env.CLAUDE_CODE_ATTRIBUTION_HEADER
    else process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = originalAttributionHeader

    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome

    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath

    if (originalShell === undefined) delete process.env.SHELL
    else process.env.SHELL = originalShell

    if (originalZdotdir === undefined) delete process.env.ZDOTDIR
    else process.env.ZDOTDIR = originalZdotdir

    if (originalDisableTerminalShellEnv === undefined) delete process.env.BEYA_DISABLE_TERMINAL_SHELL_ENV
    else process.env.BEYA_DISABLE_TERMINAL_SHELL_ENV = originalDisableTerminalShellEnv

    resetTerminalShellEnvironmentCacheForTests()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeFakeZsh(filePath: string) {
    await fs.writeFile(
      filePath,
      [
        '#!/bin/sh',
        'command=',
        'while [ "$#" -gt 0 ]; do',
        '  if [ "$1" = "-c" ]; then',
        '    shift',
        '    command="$1"',
        '    break',
        '  fi',
        '  shift',
        'done',
        'if [ -f "$HOME/.zshrc" ]; then',
        '  . "$HOME/.zshrc" </dev/null >/dev/null 2>/dev/null || true',
        'fi',
        'exec /bin/sh -c "$command"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
  }

  test('keeps inherited provider env when no desktop provider config exists', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('D:\\workspace\\code\\myself_code\\beya')) as Record<string, string>

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('test-token')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid/anthropic')
    expect(env.ANTHROPIC_MODEL).toBe('test-model')
    expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('0')
    expect(env.CLAUDE_CODE_DIAGNOSTICS_FILE).toBe(path.join(tmpDir, 'beya', 'diagnostics', 'cli-diagnostics.jsonl'))
    expect(env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE).toBe(
      `${path.join(tmpDir, 'projects', 'D--workspace-code-myself-code-beya', 'memory')}${path.sep}`,
    )
    await expect(fs.stat(path.dirname(env.CLAUDE_CODE_DIAGNOSTICS_FILE))).resolves.toBeTruthy()
  })

  test('buildChildEnv pins desktop memory to the current sanitized project directory', async () => {
    const service = new ConversationService() as any
    const workDir = path.join(tmpDir, 'workspace', 'myself_code', 'beya')
    await fs.mkdir(workDir, { recursive: true })

    const env = (await service.buildChildEnv(workDir)) as Record<string, string>

    expect(env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE).toBe(
      `${path.join(tmpDir, 'projects', sanitizeMemoryPath(workDir), 'memory')}${path.sep}`,
    )
    expect(env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE).toContain('myself-code')
    expect(env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE).not.toContain('myself_code')
  })

  ;(process.platform === 'win32' ? test.skip : test)('buildChildEnv inherits exported terminal shell variables for desktop CLI sessions', async () => {
    const shellPath = path.join(tmpDir, 'zsh')
    const nodeBin = path.join(tmpDir, 'node-bin')
    const nvmDir = path.join(tmpDir, '.nvm')
    await fs.mkdir(nodeBin, { recursive: true })
    await fs.mkdir(nvmDir, { recursive: true })
    await writeFakeZsh(shellPath)
    await fs.writeFile(
      path.join(tmpDir, '.zshrc'),
      [
        `export NVM_DIR="${nvmDir}"`,
        `export PATH="${nodeBin}:$PATH"`,
        '',
      ].join('\n'),
    )

    delete process.env.BEYA_DISABLE_TERMINAL_SHELL_ENV
    process.env.HOME = tmpDir
    process.env.SHELL = shellPath
    process.env.PATH = '/usr/bin:/bin'
    delete process.env.ZDOTDIR
    resetTerminalShellEnvironmentCacheForTests()

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(tmpDir)) as Record<string, string>

    expect(env.NVM_DIR).toBe(nvmDir)
    expect(env.PATH.split(path.delimiter)[0]).toBe(nodeBin)
    expect(env.PATH.split(path.delimiter)).toContain('/usr/bin')
  })

  test('strips inherited provider env when desktop provider config exists', async () => {
    const beyaDir = path.join(tmpDir, 'beya')
    await fs.mkdir(beyaDir, { recursive: true })
    await fs.writeFile(
      path.join(beyaDir, 'providers.json'),
      JSON.stringify({ activeId: null, providers: [] }),
      'utf-8',
    )

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('D:\\workspace\\code\\myself_code\\beya')) as Record<string, string>

    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
  })

  test('buildChildEnv injects General network timeout and manual proxy for CLI requests', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        network: {
          aiRequestTimeoutMs: 180_000,
          proxy: {
            mode: 'manual',
            url: ' http://127.0.0.1:7890 ',
          },
        },
      }),
      'utf-8',
    )

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.API_TIMEOUT_MS).toBe('180000')
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
  })

  test('buildChildEnv injects explicit provider runtime env for session-scoped providers', async () => {
    const providerService = new ProviderService()
    const provider = await providerService.addProvider({
      providerId: 'custom',
      displayName: 'Packy',
      apiKey: 'provider-key',
      baseUrl: 'https://api.packy.example',
      apiFormat: 'openai_chat',
      modelRoles: {
        primary: 'kimi-k2.6',
        fast: '',
        balanced: '',
        powerful: '',
      },
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp', undefined, {
      providerId: provider.providerId,
    })) as Record<string, string>

    expect(env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:3456/proxy/providers/${provider.providerId}`)
    expect(env.ANTHROPIC_API_KEY).toBe('proxy-managed')
    expect(env.ANTHROPIC_MODEL).toBe('kimi-k2.6')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('kimi-k2.6')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('kimi-k2.6')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('kimi-k2.6')
    expect(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe('1')
    expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('0')
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
  })

  test('buildChildEnv uses the session-selected model for session-scoped providers', async () => {
    const providerService = new ProviderService()
    const provider = await providerService.addProvider({
      providerId: 'switchable',
      displayName: 'Switchable',
      apiKey: 'provider-key',
      baseUrl: 'https://api.switchable.example',
      apiFormat: 'openai_chat',
      modelRoles: {
        primary: 'old-provider-primary',
        fast: 'new-provider-fast',
        balanced: 'new-provider-balanced',
        powerful: 'new-provider-powerful',
      },
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp', undefined, {
      providerId: provider.providerId,
      model: 'new-provider-balanced',
    })) as Record<string, string>

    expect(env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:3456/proxy/providers/${provider.providerId}`)
    expect(env.ANTHROPIC_MODEL).toBe('new-provider-balanced')
    expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('0')
  })

  test('buildChildEnv clears stale api key for bearer-token Anthropic providers', async () => {
    const providerService = new ProviderService()
    const provider = await providerService.addProvider({
      providerId: 'anthropic',
      displayName: 'Anthropic',
      apiKey: 'provider-key',
      authStrategy: 'auth_token',
      baseUrl: 'https://api.anthropic.com',
      apiFormat: 'anthropic',
      modelRoles: {
        primary: 'claude-sonnet-4-5-20250929',
        fast: 'claude-haiku-4-5-20251001',
        balanced: 'claude-sonnet-4-5-20250929',
        powerful: 'claude-opus-4-1-20250805',
      },
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp', undefined, {
      providerId: provider.providerId,
      model: 'claude-sonnet-4-5-20250929',
    })) as Record<string, string>

    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('provider-key')
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-5-20250929')
    expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('1')
  })

  test('buildChildEnv keeps General network timeout for catalog providers', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        network: {
          aiRequestTimeoutMs: 180_000,
          proxy: { mode: 'system', url: '' },
        },
      }),
      'utf-8',
    )

    const providerService = new ProviderService()
    const provider = await providerService.addProvider({
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      apiKey: 'provider-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiFormat: 'openai_chat',
      modelRoles: {
        primary: 'deepseek-chat',
        fast: 'deepseek-chat',
        balanced: 'deepseek-chat',
        powerful: 'deepseek-reasoner',
      },
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp', undefined, {
      providerId: provider.providerId,
      model: 'deepseek-chat',
    })) as Record<string, string>

    expect(env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:3456/proxy/providers/${provider.providerId}`)
    expect(env.API_TIMEOUT_MS).toBe('180000')
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBeUndefined()
  })

  test('buildChildEnv rejects the removed ChatGPT Official session provider id', async () => {
    const service = new ConversationService() as any
    await expect(service.buildChildEnv('/tmp', undefined, {
      providerId: 'openai-official',
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  test('buildChildEnv does not leak inherited CLAUDE_CODE_OAUTH_TOKEN when no provider is configured', async () => {
    const beyaDir = path.join(tmpDir, 'beya')
    await fs.mkdir(beyaDir, { recursive: true })
    await fs.writeFile(
      path.join(beyaDir, 'settings.json'),
      JSON.stringify({ env: {} }),
      'utf-8',
    )

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  test('buildChildEnv injects desktop Computer Use host bundle id for sdk sessions', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(
      '/tmp',
      'ws://127.0.0.1:3456/sessions/test-session/runtime?token=test-token',
    )) as Record<string, string>

    expect(env.BEYA_COMPUTER_USE_HOST_BUNDLE_ID).toBe(
      'cn.edu.tju.apvic.beya',
    )
    expect(env.BEYA_DESKTOP_SERVER_URL).toBe('http://127.0.0.1:3456')
    expect(env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING).toBe('1')
  })

  test('uses bun entrypoint fallback on Windows dev mode', () => {
    const service = new ConversationService() as any
    const args = service.resolveCliArgs(['--print'])

    if (process.platform === 'win32') {
      expect(args[0]).toBe(process.execPath)
      expect(args[1]).toBe('--preload')
      expect(args[2]).toContain('preload.ts')
      expect(args[3]).toContain(path.join('src', 'entrypoints', 'cli.tsx'))
    } else {
      expect(args[0]).toContain(path.join('bin', 'beya'))
    }
  })

  test('marks local_cli mode without injecting CLI-specific runtime config in session env', async () => {
    const localCliPath = path.join(tmpDir, process.platform === 'win32' ? 'codex.cmd' : 'codex')
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY
    await fs.writeFile(localCliPath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', 'utf-8')
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        localCliRuntime: {
          activeId: 'codex',
          configs: {
            codex: {
              CODEX_BIN: localCliPath,
              CODEX_HOME: path.join(tmpDir, '.codex'),
            },
          },
        },
      }),
      'utf-8',
    )

    try {
      process.env.ANTHROPIC_API_KEY = 'provider-key-that-must-not-leak'
      const service = new ConversationService() as any
      const providerModeArgs = service.resolveCliArgs(['--print'], 'provider')
      const localCliModeArgs = service.resolveCliArgs(['--print'], 'local_cli')
      const providerModeEnv = await service.buildChildEnv('/tmp', undefined, { executionMode: 'provider' })
      const localCliModeEnv = await service.buildChildEnv('/tmp', undefined, { executionMode: 'local_cli' })

      expect(providerModeArgs).not.toContain(localCliPath)
      expect(localCliModeArgs).not.toContain(localCliPath)
      expect(localCliModeArgs).toContain('--print')
      expect(providerModeEnv.BEYA_LOCAL_CLI_ID).toBeUndefined()
      expect(localCliModeEnv.ANTHROPIC_API_KEY).toBeUndefined()
      expect(localCliModeEnv).toMatchObject({
        BEYA_EXECUTION_MODE: 'local_cli',
      })
      expect(localCliModeEnv.BEYA_LOCAL_CLI_ID).toBeUndefined()
      expect(localCliModeEnv.BEYA_LOCAL_CLI_PATH).toBeUndefined()
      expect(localCliModeEnv.CODEX_BIN).toBeUndefined()
      expect(localCliModeEnv.CODEX_HOME).toBeUndefined()
    } finally {
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey
    }
  })

  test('detects embedded CLI args before starting the server executable', () => {
    const args = extractEmbeddedCliArgs([
      'beya-server.exe',
      '--preload',
      'B:\\~BUN\\root\\preload.ts',
      'B:\\~BUN\\root\\src\\entrypoints\\cli.tsx',
      '--print',
      '--runtime-url',
      'ws://127.0.0.1:3456/sessions/session/runtime?token=test',
    ])

    expect(args).toEqual([
      '--print',
      '--runtime-url',
      'ws://127.0.0.1:3456/sessions/session/runtime?token=test',
    ])
    expect(extractEmbeddedCliArgs(['beya-server.exe', '--port', '3456'])).toBeNull()
  })

  test('installs embedded CLI macro fallback before importing CLI runtime', () => {
    const globalWithMacro = globalThis as typeof globalThis & { MACRO?: { VERSION?: string } }
    const previousMacro = globalWithMacro.MACRO
    const previousVersion = process.env.BEYA_VERSION
    try {
      delete globalWithMacro.MACRO
      process.env.BEYA_VERSION = '9.9.9-test'

      ensureEmbeddedCliMacroFallback()

      expect(globalWithMacro.MACRO?.VERSION).toBe('9.9.9-test')
    } finally {
      if (previousMacro === undefined) delete globalWithMacro.MACRO
      else globalWithMacro.MACRO = previousMacro
      if (previousVersion === undefined) delete process.env.BEYA_VERSION
      else process.env.BEYA_VERSION = previousVersion
    }
  })

  test('buildSessionCliArgs enables partial assistant messages for desktop streaming', () => {
    const service = new ConversationService() as any
    const args = service.buildSessionCliArgs(
      '123e4567-e89b-12d3-a456-426614174000',
      'ws://127.0.0.1:3456/sessions/test-session/runtime?token=test-token',
      false,
      { permissionMode: 'bypassPermissions' },
    ) as string[]

    expect(args).toContain('--include-partial-messages')
    expect(args).toContain('--runtime-url')
    expect(args).toContain('--replay-user-messages')
  })

  test('buildChildEnv asks desktop SDK sessions to wait briefly for MCP tools', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(
      '/tmp',
      'ws://127.0.0.1:3456/sessions/test-session/runtime?token=test-token',
    )) as Record<string, string>

    expect(env.BEYA_DESKTOP_AWAIT_MCP).toBe('1')
    expect(env.BEYA_DESKTOP_AWAIT_MCP_TIMEOUT_MS).toBe('5000')
  })

  test('buildChildEnv forwards structured runtime metadata to CLI sessions', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(
      '/tmp',
      'ws://127.0.0.1:3456/sessions/test-session/runtime?token=test-token',
      {
        metadata: {
          user_id: 'u1',
          user_name: 'User',
          conversation_id: 'conv-1',
        },
      },
    )) as Record<string, string>

    expect(JSON.parse(env.BEYA_RUNTIME_METADATA_JSON)).toEqual({
      user_id: 'u1',
      user_name: 'User',
      conversation_id: 'conv-1',
    })
  })

  test('buildChildEnv enables stream idle watchdog for desktop CLI sessions', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(
      '/tmp',
      'ws://127.0.0.1:3456/sessions/test-session/runtime?token=test-token',
    )) as Record<string, string>

    expect(env.CLAUDE_ENABLE_STREAM_WATCHDOG).toBe('1')
  })

  test('buildSessionCliArgs forwards the selected runtime model and effort to the CLI process', () => {
    const service = new ConversationService() as any
    const args = service.buildSessionCliArgs(
      '123e4567-e89b-12d3-a456-426614174000',
      'ws://127.0.0.1:3456/sessions/test-session/runtime?token=test-token',
      false,
      {
        model: 'model-b-opus',
        effort: 'max',
      },
    ) as string[]

    expect(args).toContain('--model')
    expect(args).toContain('model-b-opus')
    expect(args).toContain('--effort')
    expect(args).toContain('max')
  })

  test('buildSessionCliArgs starts pending desktop worktrees through the native CLI flag', () => {
    const service = new ConversationService() as any
    const args = service.buildSessionCliArgs(
      '123e4567-e89b-12d3-a456-426614174000',
      'ws://127.0.0.1:3456/sessions/test-session/runtime?token=test-token',
      false,
      undefined,
      {
        requestedWorkDir: '/tmp/source-repo',
        repoRoot: '/tmp/source-repo',
        branch: 'feature/rail',
        worktree: true,
        baseRef: 'feature/rail',
        worktreeSlug: 'desktop-feature-rail-123e4567',
      },
    ) as string[]

    expect(args).toContain('--worktree')
    expect(args).toContain('desktop-feature-rail-123e4567')
    expect(args).toContain('--worktree-base-ref')
    expect(args).toContain('feature/rail')
  })

  test('local_cli execution mode runs the selected Codex CLI backend for user turns', async () => {
    const workDir = path.join(tmpDir, 'workspace')
    await fs.mkdir(workDir, { recursive: true })
    const codexPath = path.join(
      tmpDir,
      process.platform === 'win32' ? 'codex.cmd' : 'codex',
    )
    await fs.writeFile(
      codexPath,
      process.platform === 'win32'
        ? [
            '@echo off',
            'echo {"type":"item.completed","item":{"type":"assistant_message","text":"codex backend handled this turn"}}',
            '',
          ].join('\r\n')
        : [
            '#!/bin/sh',
            'cat >/dev/null',
            'printf \'%s\\n\' \'{"type":"item.completed","item":{"type":"assistant_message","text":"codex backend handled this turn"}}\'',
            '',
          ].join('\n'),
      { mode: 0o755 },
    )
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        executionMode: 'local_cli',
        localCliRuntime: {
          activeId: 'codex',
          configs: {
            codex: {
              CODEX_BIN: codexPath,
              OPENAI_API_KEY: 'explicit-codex-key',
            },
          },
        },
      }),
      'utf-8',
    )

    const service = new ConversationService()
    await service.startSession(
      'local-cli-session',
      workDir,
      'ws://127.0.0.1:3456/sessions/local-cli-session/runtime?token=test-token',
      { executionMode: 'local_cli' },
    )

    const seen: any[] = []
    const completed = new Promise<void>((resolve) => {
      service.onOutput('local-cli-session', (message) => {
        seen.push(message)
        if (message?.type === 'result') resolve()
      })
    })

    expect(await service.sendMessage('local-cli-session', 'hello codex')).toBe(true)
    await completed
    await service.stopSessionAndWait('local-cli-session', 500)

    expect(seen).toContainEqual(expect.objectContaining({
      type: 'assistant',
      message: expect.objectContaining({
        content: [{ type: 'text', text: 'codex backend handled this turn' }],
      }),
    }))
    expect(seen).toContainEqual(expect.objectContaining({
      type: 'result',
      is_error: false,
    }))
  })

  test('stopAllSessionsAndWait kills every active CLI subprocess and waits for exits', async () => {
    const service = new ConversationService() as any
    const killed: string[] = []
    const drained: string[] = []

    const makeSession = (sessionId: string) => {
      let resolveExit: (code: number) => void = () => {}
      const exited = new Promise<number>((resolve) => {
        resolveExit = resolve
      })

      return {
        runtimeKind: 'sdk',
        proc: {
          kill: () => {
            killed.push(sessionId)
            resolveExit(0)
          },
          exited,
        },
        outputCallbacks: [],
        workDir: tmpDir,
        permissionMode: 'default',
        runtimeToken: `${sessionId}-token`,
        runtimeSocket: null,
        pendingOutbound: [],
        startupPending: false,
        startupExitCode: null,
        stdoutLines: [],
        stderrLines: [],
        outputDrain: Promise.resolve().then(() => {
          drained.push(sessionId)
        }),
        runtimeMessages: [],
        initMessage: null,
        pendingPermissionRequests: new Map(),
      }
    }

    service.sessions.set('session-a', makeSession('session-a'))
    service.sessions.set('session-b', makeSession('session-b'))

    await service.stopAllSessionsAndWait(500)

    expect(killed.sort()).toEqual(['session-a', 'session-b'])
    expect(drained.sort()).toEqual(['session-a', 'session-b'])
    expect(service.getActiveSessions()).toEqual([])
  })

  test('default CLI shutdown wait covers the CLI graceful cleanup budget', () => {
    expect(DESKTOP_CLI_GRACEFUL_SHUTDOWN_TIMEOUT_MS).toBeGreaterThanOrEqual(6_000)
  })
})

function sanitizeMemoryPath(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '-')
}
