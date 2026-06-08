import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  LocalCliRuntimeService,
  getWellKnownUserToolchainBins,
  resolveSelectedLocalCliRuntimeSync,
  resolveSelectedLocalCliPathSync,
} from '../services/localCliRuntimeService.js'
import { resolveExecutionModeSync } from '../services/executionModeService.js'

describe('LocalCliRuntimeService', () => {
  let tmpDir: string
  let binDir: string
  let originalConfigDir: string | undefined
  let originalPath: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beya-local-cli-'))
    binDir = path.join(tmpDir, 'bin')
    await fs.mkdir(binDir, { recursive: true })
    originalConfigDir = process.env.BEYA_CONFIG_DIR
    originalPath = process.env.PATH
    process.env.BEYA_CONFIG_DIR = tmpDir
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`
  })

  afterEach(async () => {
    restoreEnv('BEYA_CONFIG_DIR', originalConfigDir)
    restoreEnv('PATH', originalPath)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('detects a user Codex CLI and persists it as the selected local CLI backend', async () => {
    const codexPath = await writeExecutable('codex', 'codex 1.0.0')
    const service = new LocalCliRuntimeService({ detectVersions: false })

    const list = await service.listLocalClis()
    const codex = list.clis.find((cli) => cli.id === 'codex')

    expect(list.activeId).toBe(null)
    expect(codex).toMatchObject({
      available: true,
      executablePath: codexPath,
      supportsDesktopRuntime: true,
    })

    const activated = await service.activateLocalCli('codex')
    expect(activated.activeId).toBe('codex')
    expect(resolveSelectedLocalCliPathSync({ configDir: tmpDir })).toBe(codexPath)
    expect(resolveSelectedLocalCliRuntimeSync({ configDir: tmpDir })).toMatchObject({
      id: 'codex',
      executablePath: codexPath,
      env: {
        CODEX_BIN: codexPath,
      },
      modelRoles: {
        primary: 'default',
        fast: 'default',
        balanced: 'default',
        powerful: 'default',
      },
    })
  })

  test('uses Codex debug models as live candidates and filters hidden entries', async () => {
    await writeCodexWithDebugModels({
      models: [
        { slug: 'gpt-live', display_name: 'GPT Live' },
        { slug: 'gpt-hidden', display_name: 'GPT Hidden', visibility: 'hidden' },
        { id: 'gpt-id-only', name: 'GPT ID Only' },
      ],
    })
    const service = new LocalCliRuntimeService({ detectVersions: false })

    const list = await service.listLocalClis()
    const codex = list.clis.find((cli) => cli.id === 'codex')

    expect(codex?.models).toEqual([
      { id: 'default', label: 'CLI default' },
      { id: 'gpt-live', label: 'GPT Live' },
      { id: 'gpt-id-only', label: 'GPT ID Only' },
    ])
  })

  test('defaults execution mode to provider until the user chooses local CLI mode', async () => {
    expect(resolveExecutionModeSync({ configDir: tmpDir })).toBe('provider')

    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({ executionMode: 'local_cli' }),
      'utf-8',
    )

    expect(resolveExecutionModeSync({ configDir: tmpDir })).toBe('local_cli')
  })

  test('persists provider-like Codex config and prefers CODEX_BIN over PATH', async () => {
    const pathCodex = await writeExecutable('codex', 'codex from path')
    const configuredCodex = path.join(tmpDir, process.platform === 'win32' ? 'custom-codex.cmd' : 'custom-codex')
    await fs.writeFile(configuredCodex, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', 'utf-8')
    if (process.platform !== 'win32') await fs.chmod(configuredCodex, 0o755)
    const service = new LocalCliRuntimeService({ detectVersions: false })

    await service.updateLocalCliConfig('codex', {
      CODEX_BIN: configuredCodex,
      CODEX_HOME: path.join(tmpDir, '.codex'),
      UNKNOWN_KEY: 'ignored',
    })
    const list = await service.activateLocalCli('codex')

    expect(pathCodex).toBeTruthy()
    expect(list.clis.find((cli) => cli.id === 'codex')).toMatchObject({
      available: true,
      executablePath: configuredCodex,
      source: 'configured',
      config: {
        CODEX_BIN: configuredCodex,
        CODEX_HOME: path.join(tmpDir, '.codex'),
      },
    })
    expect(resolveSelectedLocalCliRuntimeSync({ configDir: tmpDir })).toMatchObject({
      id: 'codex',
      executablePath: configuredCodex,
      env: {
        CODEX_BIN: configuredCodex,
        CODEX_HOME: path.join(tmpDir, '.codex'),
      },
    })
  })

  test('recognizes legacy CODEX_CLI_PATH as a Codex binary override', async () => {
    const originalCodexCliPath = process.env.CODEX_CLI_PATH
    const codexPath = await writeExecutable('codex-legacy', 'codex legacy env')
    try {
      process.env.CODEX_CLI_PATH = codexPath
      const service = new LocalCliRuntimeService({ detectVersions: false })

      const list = await service.listLocalClis()
      const codex = list.clis.find((cli) => cli.id === 'codex')

      expect(codex).toMatchObject({
        available: true,
        executablePath: codexPath,
        source: 'env',
      })
    } finally {
      restoreEnv('CODEX_CLI_PATH', originalCodexCliPath)
    }
  })

  test('does not expose an unavailable known CLI backend as active', async () => {
    const service = new LocalCliRuntimeService({ detectVersions: false })

    const activated = await service.activateLocalCli('qoder')
    const qoder = activated.clis.find((cli) => cli.id === 'qoder')

    expect(activated.activeId).toBe(null)
    expect(qoder).toMatchObject({
      available: false,
      executablePath: null,
      launchPath: null,
    })
    expect(resolveSelectedLocalCliRuntimeSync({ configDir: tmpDir })).toBe(null)
  })

  test('persists model mapping and context settings for a local CLI', async () => {
    const codexPath = await writeExecutable('codex', 'codex 1.0.0')
    const service = new LocalCliRuntimeService({ detectVersions: false })

    await service.updateLocalCliConfig('codex', {
      modelRoles: {
        primary: 'gpt-5-codex',
        fast: 'gpt-5',
        balanced: '',
        powerful: 'o3',
      },
      autoCompactWindow: 128000,
      modelContextWindows: {
        'gpt-5-codex': 256000,
      },
    })
    await service.activateLocalCli('codex')

    const list = await service.listLocalClis()
    expect(list.clis.find((cli) => cli.id === 'codex')).toMatchObject({
      modelRoles: {
        primary: 'gpt-5-codex',
        fast: 'gpt-5',
        balanced: 'gpt-5-codex',
        powerful: 'o3',
      },
      autoCompactWindow: 128000,
      modelContextWindows: {
        'gpt-5-codex': 256000,
      },
    })
    expect(resolveSelectedLocalCliRuntimeSync({ configDir: tmpDir })).toMatchObject({
      id: 'codex',
      executablePath: codexPath,
      modelRoles: {
        primary: 'gpt-5-codex',
        fast: 'gpt-5',
        balanced: 'gpt-5-codex',
        powerful: 'o3',
      },
      autoCompactWindow: 128000,
      modelContextWindows: {
        'gpt-5-codex': 256000,
      },
    })
  })

  test('tests a detected Codex CLI through the local CLI API service', async () => {
    const codexPath = await writeExecutable('codex', 'codex 1.2.3')
    const service = new LocalCliRuntimeService()

    const result = await service.testLocalCli('codex')

    expect(result).toMatchObject({
      success: true,
      executablePath: codexPath,
      launchPath: codexPath,
      version: 'codex 1.2.3',
    })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  test('ports Open Design user toolchain bin discovery into the local scan list', () => {
    const bins = getWellKnownUserToolchainBins({
      homeDir: path.join('C:', 'Users', 'dev'),
      env: {
        APPDATA: path.join('C:', 'Users', 'dev', 'AppData', 'Roaming'),
        VP_HOME: path.join('D:', 'vp'),
        NPM_CONFIG_PREFIX: path.join('D:', 'npm'),
        LOCALAPPDATA: path.join('C:', 'Users', 'dev', 'AppData', 'Local'),
      },
      platform: 'win32',
    })

    expect(bins).toContain(path.join('D:', 'vp', 'bin'))
    expect(bins).toContain(path.join('D:', 'npm', 'bin'))
    expect(bins).toContain(path.join('C:', 'Users', 'dev', 'scoop', 'shims'))
    expect(bins).toContain(path.join('C:', 'Users', 'dev', 'AppData', 'Roaming', 'npm'))
    expect(bins).toContain(path.join('C:', 'Users', 'dev', 'AppData', 'Local', 'pnpm'))
  })

  async function writeExecutable(command: string, versionText: string): Promise<string> {
    const filePath = process.platform === 'win32'
      ? path.join(binDir, `${command}.cmd`)
      : path.join(binDir, command)
    const contents = process.platform === 'win32'
      ? `@echo off\r\necho ${versionText}\r\n`
      : `#!/bin/sh\necho ${versionText}\n`
    await fs.writeFile(filePath, contents, 'utf-8')
    if (process.platform !== 'win32') {
      await fs.chmod(filePath, 0o755)
    }
    return filePath
  }

  async function writeCodexWithDebugModels(payload: unknown): Promise<string> {
    const filePath = process.platform === 'win32'
      ? path.join(binDir, 'codex.cmd')
      : path.join(binDir, 'codex')
    const json = JSON.stringify(payload)
    const contents = process.platform === 'win32'
      ? [
          '@echo off',
          'if "%1"=="debug" if "%2"=="models" (',
          `  echo ${json}`,
          '  exit /b 0',
          ')',
          'echo codex 1.0.0',
          '',
        ].join('\r\n')
      : [
          '#!/bin/sh',
          'if [ "$1" = "debug" ] && [ "$2" = "models" ]; then',
          "cat <<'JSON'",
          json,
          'JSON',
          'exit 0',
          'fi',
          'echo codex 1.0.0',
          '',
        ].join('\n')
    await fs.writeFile(filePath, contents, 'utf-8')
    if (process.platform !== 'win32') {
      await fs.chmod(filePath, 0o755)
    }
    return filePath
  }
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
