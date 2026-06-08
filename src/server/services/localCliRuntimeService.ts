import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { ApiError } from '../middleware/errorHandler.js'
import { SettingsService } from './settingsService.js'

const execFileAsync = promisify(execFile)

const LOCAL_CLI_SETTINGS_KEY = 'localCliRuntime'
const VERSION_TIMEOUT_MS = 1_500
const MODEL_SCAN_TIMEOUT_MS = 2_500
const AUTO_COMPACT_WINDOW_MIN = 16_000
const AUTO_COMPACT_WINDOW_MAX = 10_000_000

export type LocalCliModelRoles = {
  primary: string
  fast: string
  balanced: string
  powerful: string
}

export type LocalCliModelContextWindows = Record<string, number>

export type LocalCliModelOption = {
  id: string
  label: string
}

export type UpdateLocalCliRuntimeInput = {
  config?: Record<string, unknown>
  modelRoles?: Partial<LocalCliModelRoles> | null
  autoCompactWindow?: number | null
  modelContextWindows?: LocalCliModelContextWindows | null
}

const DEFAULT_LOCAL_CLI_MODEL: LocalCliModelOption = {
  id: 'default',
  label: 'CLI default',
}

type KnownCliDefinition = {
  id: string
  displayName: string
  commands: string[]
  binEnvKey: string
  extraBinEnvKeys?: string[]
  configKeys: string[]
  fallbackModels?: LocalCliModelOption[]
  listModels?: {
    args: string[]
    parse: (output: string) => LocalCliModelOption[]
  }
  installUrl?: string
  docsUrl?: string
}

const KNOWN_CLIS: KnownCliDefinition[] = [
  {
    id: 'amr',
    displayName: 'Open Design AMR',
    commands: ['vela'],
    binEnvKey: 'VELA_BIN',
    configKeys: [
      'VELA_BIN',
      'VELA_LINK_URL',
      'VELA_RUNTIME_KEY',
      'VELA_OPENCODE_BIN',
      'OPEN_DESIGN_AMR_PROFILE',
      'OPENCODE_TEST_HOME',
    ],
  },
  {
    id: 'aider',
    displayName: 'Aider',
    commands: ['aider'],
    binEnvKey: 'AIDER_BIN',
    configKeys: ['AIDER_BIN'],
  },
  {
    id: 'claude',
    displayName: 'Claude Code',
    commands: ['claude'],
    binEnvKey: 'CLAUDE_BIN',
    extraBinEnvKeys: ['CLAUDE_CLI_PATH'],
    fallbackModels: [
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'opus', label: 'Opus' },
      { id: 'haiku', label: 'Haiku' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    ],
    configKeys: [
      'CLAUDE_BIN',
      'CLAUDE_CONFIG_DIR',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'MMD_MODEL_ROUTES_FILE',
    ],
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    commands: ['codex'],
    binEnvKey: 'CODEX_BIN',
    extraBinEnvKeys: ['CODEX_CLI_PATH'],
    fallbackModels: [
      { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'o3', label: 'o3' },
    ],
    listModels: {
      args: ['debug', 'models'],
      parse: parseCodexModelList,
    },
    configKeys: [
      'CODEX_BIN',
      'CODEX_HOME',
      'OPENAI_BASE_URL',
      'CODEX_API_KEY',
      'OPENAI_API_KEY',
    ],
    installUrl: 'https://github.com/openai/codex',
    docsUrl: 'https://developers.openai.com/codex',
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    commands: ['copilot'],
    binEnvKey: 'COPILOT_BIN',
    configKeys: ['COPILOT_BIN'],
  },
  {
    id: 'cursor-agent',
    displayName: 'Cursor Agent',
    commands: ['cursor-agent'],
    binEnvKey: 'CURSOR_AGENT_BIN',
    configKeys: ['CURSOR_AGENT_BIN'],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek CLI',
    commands: ['deepseek'],
    binEnvKey: 'DEEPSEEK_BIN',
    configKeys: ['DEEPSEEK_BIN'],
  },
  {
    id: 'devin',
    displayName: 'Devin CLI',
    commands: ['devin'],
    binEnvKey: 'DEVIN_BIN',
    configKeys: ['DEVIN_BIN'],
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    commands: ['gemini'],
    binEnvKey: 'GEMINI_BIN',
    fallbackModels: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    configKeys: ['GEMINI_BIN', 'GEMINI_API_KEY'],
  },
  {
    id: 'hermes',
    displayName: 'Hermes',
    commands: ['hermes'],
    binEnvKey: 'HERMES_BIN',
    configKeys: ['HERMES_BIN'],
  },
  {
    id: 'kimi',
    displayName: 'Kimi CLI',
    commands: ['kimi'],
    binEnvKey: 'KIMI_BIN',
    configKeys: ['KIMI_BIN'],
  },
  {
    id: 'kiro',
    displayName: 'Kiro',
    commands: ['kiro'],
    binEnvKey: 'KIRO_BIN',
    configKeys: ['KIRO_BIN'],
  },
  {
    id: 'kilo',
    displayName: 'Kilo',
    commands: ['kilo'],
    binEnvKey: 'KILO_BIN',
    configKeys: ['KILO_BIN'],
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    commands: ['opencode', 'opencode-cli'],
    binEnvKey: 'OPENCODE_BIN',
    configKeys: ['OPENCODE_BIN'],
  },
  {
    id: 'pi',
    displayName: 'Pi CLI',
    commands: ['pi'],
    binEnvKey: 'PI_BIN',
    configKeys: ['PI_BIN'],
  },
  {
    id: 'qoder',
    displayName: 'Qoder',
    commands: ['qoder'],
    binEnvKey: 'QODER_BIN',
    configKeys: ['QODER_BIN'],
  },
  {
    id: 'qwen',
    displayName: 'Qwen Code',
    commands: ['qwen'],
    binEnvKey: 'QWEN_BIN',
    fallbackModels: [
      { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus' },
      { id: 'qwen3-coder-flash', label: 'Qwen3 Coder Flash' },
    ],
    configKeys: ['QWEN_BIN', 'DASHSCOPE_API_KEY'],
  },
  {
    id: 'trae-cli',
    displayName: 'Trae CLI',
    commands: ['trae-cli'],
    binEnvKey: 'TRAE_CLI_BIN',
    configKeys: ['TRAE_CLI_BIN'],
  },
  {
    id: 'vibe',
    displayName: 'Vibe',
    commands: ['vibe'],
    binEnvKey: 'VIBE_BIN',
    configKeys: ['VIBE_BIN'],
  },
  {
    id: 'reasonix',
    displayName: 'Reasonix',
    commands: ['reasonix'],
    binEnvKey: 'REASONIX_BIN',
    configKeys: ['REASONIX_BIN'],
  },
]

export type LocalCliSource =
  | 'configured'
  | 'env'
  | 'path'
  | 'toolchain'

export type LocalCliRuntimeSettings = {
  activeId: string | null
  configs: Record<string, Record<string, string>>
  modelRoles: Record<string, LocalCliModelRoles>
  autoCompactWindows: Record<string, number>
  modelContextWindows: Record<string, LocalCliModelContextWindows>
}

export type LocalCliRuntimeInfo = {
  id: string
  displayName: string
  command: string
  executablePath: string | null
  launchPath: string | null
  launchKind: 'selected' | 'codex-native'
  source: LocalCliSource | null
  available: boolean
  supportsDesktopRuntime: boolean
  version: string | null
  config: Record<string, string>
  models: LocalCliModelOption[]
  modelRoles: LocalCliModelRoles
  enabledModels: string[]
  autoCompactWindow?: number
  modelContextWindows?: LocalCliModelContextWindows
  installUrl?: string
  docsUrl?: string
  diagnostic?: string | null
}

export type LocalCliRuntimeList = {
  activeId: string | null
  clis: LocalCliRuntimeInfo[]
}

export type SelectedLocalCliRuntime = {
  id: string
  displayName: string
  executablePath: string
  launchPath: string
  childPathPrepend: string[]
  env: Record<string, string>
  modelRoles: LocalCliModelRoles
  autoCompactWindow?: number
  modelContextWindows?: LocalCliModelContextWindows
}

export type LocalCliTestResult = {
  success: boolean
  latencyMs: number
  version: string | null
  executablePath: string | null
  launchPath: string | null
  error?: string
}

type Candidate = {
  filePath: string
  source: LocalCliSource
  command: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function defaultModelOptions(definition: KnownCliDefinition): LocalCliModelOption[] {
  return definition.fallbackModels ?? []
}

function normalizeModelOptions(
  models: LocalCliModelOption[],
  options: { includeDefault?: boolean } = {},
): LocalCliModelOption[] {
  const { includeDefault = false } = options
  const seen = new Set<string>()
  const result: LocalCliModelOption[] = []
  const source = includeDefault ? [DEFAULT_LOCAL_CLI_MODEL, ...models] : models
  for (const model of source) {
    const id = model.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      label: model.label.trim() || id,
    })
  }
  return result
}

function createDefaultModelRoles(definition: KnownCliDefinition): LocalCliModelRoles {
  const fallbackModels = defaultModelOptions(definition)
  const primary = fallbackModels[0]?.id.trim() || DEFAULT_LOCAL_CLI_MODEL.id
  return {
    primary,
    fast: primary,
    balanced: primary,
    powerful: primary,
  }
}

function sanitizeModelRoles(
  value: unknown,
  fallback: LocalCliModelRoles,
): LocalCliModelRoles {
  if (!isRecord(value)) return fallback
  const primary = typeof value.primary === 'string' && value.primary.trim()
    ? value.primary.trim()
    : fallback.primary
  return {
    primary,
    fast: typeof value.fast === 'string' && value.fast.trim()
      ? value.fast.trim()
      : primary,
    balanced: typeof value.balanced === 'string' && value.balanced.trim()
      ? value.balanced.trim()
      : primary,
    powerful: typeof value.powerful === 'string' && value.powerful.trim()
      ? value.powerful.trim()
      : primary,
  }
}

function sanitizeAutoCompactWindow(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  if (rounded < AUTO_COMPACT_WINDOW_MIN || rounded > AUTO_COMPACT_WINDOW_MAX) {
    return undefined
  }
  return rounded
}

function sanitizeModelContextWindows(value: unknown): LocalCliModelContextWindows | undefined {
  if (!isRecord(value)) return undefined
  const result: LocalCliModelContextWindows = {}
  for (const [modelId, rawWindow] of Object.entries(value)) {
    const model = modelId.trim()
    const window = sanitizeAutoCompactWindow(rawWindow)
    if (model && window !== undefined) {
      result[model] = window
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function knownCliById(id: string | null | undefined): KnownCliDefinition | null {
  if (!id) return null
  return KNOWN_CLIS.find((definition) => definition.id === id) ?? null
}

function sanitizeCliConfig(
  definition: KnownCliDefinition,
  value: unknown,
): Record<string, string> {
  if (!isRecord(value)) return {}
  const allowedKeys = new Set(definition.configKeys)
  const result: Record<string, string> = {}

  for (const [key, raw] of Object.entries(value)) {
    if (!allowedKeys.has(key) || typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed) result[key] = trimmed
  }

  return result
}

function normalizeLocalCliSettings(value: unknown): LocalCliRuntimeSettings {
  if (!isRecord(value)) {
    return {
      activeId: null,
      configs: {},
      modelRoles: {},
      autoCompactWindows: {},
      modelContextWindows: {},
    }
  }

  const configs: Record<string, Record<string, string>> = {}
  const modelRoles: Record<string, LocalCliModelRoles> = {}
  const autoCompactWindows: Record<string, number> = {}
  const modelContextWindows: Record<string, LocalCliModelContextWindows> = {}
  if (isRecord(value.configs)) {
    for (const definition of KNOWN_CLIS) {
      const config = sanitizeCliConfig(definition, value.configs[definition.id])
      if (Object.keys(config).length > 0) configs[definition.id] = config
    }
  }
  if (isRecord(value.modelRoles)) {
    for (const definition of KNOWN_CLIS) {
      const roles = sanitizeModelRoles(
        value.modelRoles[definition.id],
        createDefaultModelRoles(definition),
      )
      if (JSON.stringify(roles) !== JSON.stringify(createDefaultModelRoles(definition))) {
        modelRoles[definition.id] = roles
      }
    }
  }
  if (isRecord(value.autoCompactWindows)) {
    for (const definition of KNOWN_CLIS) {
      const window = sanitizeAutoCompactWindow(value.autoCompactWindows[definition.id])
      if (window !== undefined) autoCompactWindows[definition.id] = window
    }
  }
  if (isRecord(value.modelContextWindows)) {
    for (const definition of KNOWN_CLIS) {
      const windows = sanitizeModelContextWindows(value.modelContextWindows[definition.id])
      if (windows) modelContextWindows[definition.id] = windows
    }
  }

  const legacyActiveId =
    typeof value.activeId === 'string' && value.activeId.trim()
      ? value.activeId.trim()
      : null
  const activeId = knownCliById(legacyActiveId) ? legacyActiveId : null

  if (
    activeId &&
    typeof value.activePath === 'string' &&
    value.activePath.trim() &&
    !configs[activeId]?.[knownCliById(activeId)!.binEnvKey]
  ) {
    configs[activeId] = {
      ...(configs[activeId] ?? {}),
      [knownCliById(activeId)!.binEnvKey]: value.activePath.trim(),
    }
  }

  return {
    activeId,
    configs,
    modelRoles,
    autoCompactWindows,
    modelContextWindows,
  }
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function expandHomePath(value: string, homeDir = os.homedir()): string {
  if (value === '~') return homeDir
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(homeDir, value.slice(2))
  }
  return value
}

function getPathEntries(env: NodeJS.ProcessEnv = process.env): string[] {
  const pathValue = env.PATH || env.Path || env.path || ''
  return uniqueStrings(pathValue.split(path.delimiter))
}

function versionSortDescending(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })
}

export function getWellKnownUserToolchainBins(
  options: {
    homeDir?: string
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    includeSystemBins?: boolean
  } = {},
): string[] {
  const homeDir = options.homeDir ?? os.homedir()
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const appData = env.APPDATA
  const localAppData = env.LOCALAPPDATA
  const programFiles = env.ProgramFiles || env['ProgramFiles(x86)']
  const bins = [
    env.VP_HOME ? path.join(env.VP_HOME, 'bin') : undefined,
    env.NPM_CONFIG_PREFIX ? path.join(env.NPM_CONFIG_PREFIX, 'bin') : undefined,
    env.npm_config_prefix ? path.join(env.npm_config_prefix, 'bin') : undefined,
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, '.vite-plus', 'bin'),
    path.join(homeDir, '.opencode', 'bin'),
    path.join(homeDir, '.bun', 'bin'),
    path.join(homeDir, '.volta', 'bin'),
    path.join(homeDir, '.asdf', 'shims'),
    path.join(homeDir, 'Library', 'pnpm'),
    path.join(homeDir, '.cargo', 'bin'),
    path.join(homeDir, '.npm-global', 'bin'),
    path.join(homeDir, '.npm-packages', 'bin'),
    path.join(homeDir, '.deno', 'bin'),
    path.join(homeDir, 'go', 'bin'),
    path.join(homeDir, '.pyenv', 'shims'),
    env.MISE_DATA_DIR
      ? path.join(env.MISE_DATA_DIR, 'shims')
      : path.join(homeDir, '.local', 'share', 'mise', 'shims'),
    path.join(homeDir, '.mise', 'shims'),
    platform === 'win32' ? path.join(homeDir, 'scoop', 'shims') : undefined,
    platform === 'win32' && appData ? path.join(appData, 'npm') : undefined,
    platform === 'win32' && appData ? path.join(appData, 'pnpm') : undefined,
    platform === 'win32' && localAppData ? path.join(localAppData, 'pnpm') : undefined,
    platform === 'win32' && localAppData ? path.join(localAppData, 'Yarn', 'bin') : undefined,
    platform === 'win32' && localAppData ? path.join(localAppData, 'Programs', 'nodejs') : undefined,
    platform === 'win32' && localAppData ? path.join(localAppData, 'Microsoft', 'WindowsApps') : undefined,
    platform === 'win32' && programFiles ? path.join(programFiles, 'nodejs') : undefined,
    options.includeSystemBins !== false && platform !== 'win32' ? '/usr/local/bin' : undefined,
    options.includeSystemBins !== false && platform !== 'win32' ? '/opt/homebrew/bin' : undefined,
    options.includeSystemBins !== false && platform !== 'win32' ? '/usr/bin' : undefined,
  ]

  return uniqueStrings(bins)
}

function listVersionedBinDirs(parent: string): string[] {
  try {
    return fs.readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(versionSortDescending)
      .map((name) => path.join(parent, name, 'bin'))
  } catch {
    return []
  }
}

function getVersionManagerBins(
  options: {
    homeDir?: string
    env?: NodeJS.ProcessEnv
  } = {},
): string[] {
  const homeDir = options.homeDir ?? os.homedir()
  const env = options.env ?? process.env
  const miseRoot = env.MISE_DATA_DIR ?? path.join(homeDir, '.local', 'share', 'mise')
  const nvmRoot = env.NVM_DIR ?? path.join(homeDir, '.nvm')
  const fnmRoot = env.FNM_DIR ?? path.join(homeDir, '.fnm')

  return uniqueStrings([
    ...listVersionedBinDirs(path.join(miseRoot, 'installs', 'node')),
    ...listVersionedBinDirs(path.join(nvmRoot, 'versions', 'node')),
    ...listVersionedBinDirs(path.join(fnmRoot, 'node-versions')),
  ])
}

function getExecutableExtensions(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return ['']
  const pathext = env.PATHEXT || '.EXE;.CMD;.BAT;.COM'
  return uniqueStrings([
    '',
    ...pathext.split(';').map((entry) => entry.toLowerCase()),
    '.exe',
    '.cmd',
    '.bat',
  ])
}

function hasKnownExtension(command: string): boolean {
  return Boolean(path.extname(command))
}

function fileExists(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

function isExecutableFile(filePath: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    if (platform !== 'win32') fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveConfiguredExecutable(
  rawPath: string | undefined,
  homeDir: string,
  platform: NodeJS.Platform,
): string | null {
  const trimmed = rawPath?.trim()
  if (!trimmed) return null
  const expanded = expandHomePath(trimmed, homeDir)
  if (!path.isAbsolute(expanded)) return null
  return isExecutableFile(expanded, platform) ? expanded : null
}

function resolveExecutableInDir(
  dir: string,
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | null {
  const candidates = hasKnownExtension(command)
    ? [path.join(dir, command)]
    : getExecutableExtensions(env, platform).map((ext) => path.join(dir, `${command}${ext}`))

  return candidates.find(fileExists) ?? null
}

function collectCandidates(
  definition: KnownCliDefinition,
  settings: LocalCliRuntimeSettings,
  options: {
    homeDir?: string
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
  } = {},
): Candidate[] {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? os.homedir()
  const pathDirs = getPathEntries(env)
  const toolchainDirs = [
    ...getWellKnownUserToolchainBins({ ...options, homeDir }),
    ...getVersionManagerBins({ ...options, homeDir }),
  ]
  const config = settings.configs[definition.id] ?? {}
  const candidates: Candidate[] = []
  const configuredPath = config[definition.binEnvKey]

  if (configuredPath) {
    const expanded = resolveConfiguredExecutable(configuredPath, homeDir, platform)
    if (expanded) {
      candidates.push({
        filePath: expanded,
        source: 'configured',
        command: definition.commands[0] ?? definition.id,
      })
    }
  }

  for (const envKey of [definition.binEnvKey, ...(definition.extraBinEnvKeys ?? [])]) {
    const envConfiguredPath = env[envKey]
    if (!envConfiguredPath) continue
    const expanded = resolveConfiguredExecutable(envConfiguredPath, homeDir, platform)
    if (expanded) {
      candidates.push({
        filePath: expanded,
        source: 'env',
        command: definition.commands[0] ?? definition.id,
      })
    }
  }

  for (const dir of pathDirs) {
    for (const command of definition.commands) {
      const filePath = resolveExecutableInDir(dir, command, env, platform)
      if (filePath) candidates.push({ filePath, source: 'path', command })
    }
  }

  for (const dir of toolchainDirs) {
    for (const command of definition.commands) {
      const filePath = resolveExecutableInDir(dir, command, env, platform)
      if (filePath) candidates.push({ filePath, source: 'toolchain', command })
    }
  }

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = path.normalize(candidate.filePath).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function quoteWindowsCommandArg(arg: string): string {
  if (!/[()\][%!^"`<>&|;,\s]/.test(arg)) {
    return arg
  }
  return `"${arg.replace(/(["\\])/g, '\\$1')}"`
}

function createCliInvocation(filePath: string, args: string[]): { file: string; args: string[] } {
  const extension = path.extname(filePath).toLowerCase()
  if (process.platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    return {
      file: 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        [quoteWindowsCommandArg(filePath), ...args.map(quoteWindowsCommandArg)].join(' '),
      ],
    }
  }
  return { file: filePath, args }
}

function createVersionInvocation(filePath: string): { file: string; args: string[] } {
  return createCliInvocation(filePath, ['--version'])
}

async function detectVersion(filePath: string): Promise<string | null> {
  try {
    const invocation = createVersionInvocation(filePath)
    const result = await execFileAsync(invocation.file, invocation.args, {
      timeout: VERSION_TIMEOUT_MS,
      windowsHide: true,
    })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
    return output ? output.slice(0, 160) : null
  } catch {
    return null
  }
}

function pickModelId(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!isRecord(value)) return null
  for (const key of ['id', 'slug', 'model', 'name']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return null
}

function pickModelLabel(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback
  for (const key of ['label', 'display_name', 'displayName', 'name', 'id']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return fallback
}

function collectModelOptionsFromUnknown(value: unknown): LocalCliModelOption[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const id = pickModelId(entry)
      return id ? [{ id, label: pickModelLabel(entry, id) }] : collectModelOptionsFromUnknown(entry)
    })
  }
  if (!isRecord(value)) return []

  const directModels = value.models ?? value.data ?? value.items ?? value.available_models
  if (directModels !== undefined) {
    const models = collectModelOptionsFromUnknown(directModels)
    if (models.length > 0) return models
  }

  const id = pickModelId(value)
  return id ? [{ id, label: pickModelLabel(value, id) }] : []
}

function parseJsonModelOptions(output: string): LocalCliModelOption[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  try {
    return collectModelOptionsFromUnknown(JSON.parse(trimmed))
  } catch {
    const jsonObjectMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonObjectMatch) return []
    try {
      return collectModelOptionsFromUnknown(JSON.parse(jsonObjectMatch[0]))
    } catch {
      return []
    }
  }
}

function parseLineModelOptions(output: string): LocalCliModelOption[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[*\-\s]+/, '').trim())
    .filter((line) => /^[a-z0-9][a-z0-9_.:/+-]*$/i.test(line))
    .map((id) => ({ id, label: id }))
}

function parseCodexModelList(output: string): LocalCliModelOption[] {
  try {
    const parsed = JSON.parse(output.trim()) as { models?: unknown }
    if (Array.isArray(parsed.models)) {
      const models = parsed.models.flatMap((raw): LocalCliModelOption[] => {
        if (!isRecord(raw) || raw.visibility === 'hidden') return []
        const id =
          typeof raw.slug === 'string' && raw.slug.trim()
            ? raw.slug.trim()
            : typeof raw.id === 'string' && raw.id.trim()
              ? raw.id.trim()
              : ''
        if (!id) return []
        const label =
          typeof raw.display_name === 'string' && raw.display_name.trim()
            ? raw.display_name.trim()
            : typeof raw.name === 'string' && raw.name.trim()
              ? raw.name.trim()
              : id
        return [{ id, label }]
      })
      if (models.length > 0) return normalizeModelOptions(models)
    }
  } catch {
    // Older CLIs and wrappers may print plain text; fall through to generic parsers.
  }
  const parsed = parseJsonModelOptions(output)
  if (parsed.length > 0) return normalizeModelOptions(parsed)
  return normalizeModelOptions(parseLineModelOptions(output))
}

async function scanCliModels(
  definition: KnownCliDefinition,
  launchPath: string | null,
): Promise<LocalCliModelOption[]> {
  if (!launchPath || !definition.listModels) {
    const fallbacks = defaultModelOptions(definition)
    return normalizeModelOptions(fallbacks, { includeDefault: fallbacks.length > 0 })
  }

  try {
    const invocation = createCliInvocation(launchPath, definition.listModels.args)
    const result = await execFileAsync(invocation.file, invocation.args, {
      timeout: MODEL_SCAN_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    const models = normalizeModelOptions(definition.listModels.parse(output))
    if (models.length > 0) return models
    const fallbacks = defaultModelOptions(definition)
    return normalizeModelOptions(fallbacks, { includeDefault: fallbacks.length > 0 })
  } catch {
    const fallbacks = defaultModelOptions(definition)
    return normalizeModelOptions(fallbacks, { includeDefault: fallbacks.length > 0 })
  }
}

function safeRealpath(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath)
  } catch {
    return null
  }
}

function codexNativePackageSuffix(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`
}

function codexNativeTargetTriple(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin'
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin'
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-musl'
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-musl'
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc'
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc'
  return `${platform}-${arch}`
}

function codexSearchRoots(wrapperPath: string): string[] {
  const roots = new Set<string>()
  for (const seed of [wrapperPath, safeRealpath(wrapperPath)]) {
    if (!seed) continue
    let current = path.dirname(seed)
    while (current !== path.dirname(current)) {
      roots.add(current)
      current = path.dirname(current)
    }
  }
  return [...roots]
}

function codexNativeCandidates(
  root: string,
  packageSuffix = codexNativePackageSuffix(),
  targetTriple = codexNativeTargetTriple(),
): Array<{ filePath: string; childPathPrepend: string[] }> {
  const scoped = path.join(root, 'node_modules', '@openai')
  const packageDirs = [path.join(scoped, `codex-${packageSuffix}`)]
  try {
    for (const entry of fs.readdirSync(scoped, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('codex-')) {
        packageDirs.push(path.join(scoped, entry.name))
      }
    }
  } catch {
    // Optional package layouts vary by package manager.
  }

  return [...new Set(packageDirs)].flatMap((dir) => {
    const vendorPathDir = path.join(dir, 'vendor', targetTriple, 'path')
    const childPathPrepend = [vendorPathDir]
    return [
      { filePath: path.join(dir, 'vendor', targetTriple, 'codex', 'codex'), childPathPrepend },
      { filePath: path.join(dir, 'vendor', targetTriple, 'codex', 'codex.exe'), childPathPrepend },
      { filePath: path.join(dir, 'codex'), childPathPrepend },
      { filePath: path.join(dir, 'bin', 'codex'), childPathPrepend },
      { filePath: path.join(dir, 'vendor', 'codex'), childPathPrepend },
      { filePath: path.join(dir, 'codex.exe'), childPathPrepend },
      { filePath: path.join(dir, 'bin', 'codex.exe'), childPathPrepend },
    ]
  })
}

function existingDirectories(dirs: string[]): string[] {
  return dirs.filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

function looksLikeCodexNodeWrapper(filePath: string): boolean {
  try {
    const body = fs.readFileSync(filePath, 'utf-8').slice(0, 64_000)
    return /node|@openai\/codex|codex-/i.test(body)
  } catch {
    return false
  }
}

function resolveLaunchPath(
  definition: KnownCliDefinition,
  candidate: Candidate | undefined,
): {
  launchPath: string | null
  launchKind: 'selected' | 'codex-native'
  childPathPrepend: string[]
  diagnostic: string | null
} {
  if (!candidate) {
    return {
      launchPath: null,
      launchKind: 'selected',
      childPathPrepend: [],
      diagnostic: null,
    }
  }
  const wrapperDir = path.isAbsolute(candidate.filePath)
    ? [path.dirname(candidate.filePath)]
    : []
  if (definition.id !== 'codex') {
    return {
      launchPath: candidate.filePath,
      launchKind: 'selected',
      childPathPrepend: wrapperDir,
      diagnostic: null,
    }
  }

  for (const root of codexSearchRoots(candidate.filePath)) {
    for (const nativeCandidate of codexNativeCandidates(root)) {
      if (isExecutableFile(nativeCandidate.filePath)) {
        return {
          launchPath: nativeCandidate.filePath,
          launchKind: 'codex-native',
          childPathPrepend: [
            ...wrapperDir,
            ...existingDirectories(nativeCandidate.childPathPrepend),
          ],
          diagnostic: null,
        }
      }
    }
  }

  if (!looksLikeCodexNodeWrapper(candidate.filePath)) {
    return {
      launchPath: candidate.filePath,
      launchKind: 'selected',
      childPathPrepend: wrapperDir,
      diagnostic: null,
    }
  }

  return {
    launchPath: candidate.filePath,
    launchKind: 'selected',
    childPathPrepend: wrapperDir,
    diagnostic: `Codex native binary was not found for ${codexNativePackageSuffix()}/${codexNativeTargetTriple()}; falling back to wrapper ${candidate.filePath}. Set CODEX_BIN to a native Codex binary if this wrapper cannot launch from a GUI environment.`,
  }
}

function selectedRuntimeFromSettings(
  settings: LocalCliRuntimeSettings,
  options: {
    id?: string | null
    configDir?: string
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    homeDir?: string
  } = {},
): SelectedLocalCliRuntime | null {
  const definition = knownCliById(options.id ?? settings.activeId)
  if (!definition) return null

  const candidate = collectCandidates(definition, settings, options)[0]
  if (!candidate) return null
  const launch = resolveLaunchPath(definition, candidate)

  const config = settings.configs[definition.id] ?? {}
  return {
    id: definition.id,
    displayName: definition.displayName,
    executablePath: candidate.filePath,
    launchPath: launch.launchPath ?? candidate.filePath,
    childPathPrepend: launch.childPathPrepend,
    env: {
      ...config,
      [definition.binEnvKey]: launch.launchPath ?? candidate.filePath,
    },
    modelRoles: settings.modelRoles[definition.id] ?? createDefaultModelRoles(definition),
    ...(settings.autoCompactWindows[definition.id] !== undefined
      ? { autoCompactWindow: settings.autoCompactWindows[definition.id] }
      : {}),
    ...(settings.modelContextWindows[definition.id]
      ? { modelContextWindows: settings.modelContextWindows[definition.id] }
      : {}),
  }
}

export function resolveSelectedLocalCliRuntimeSync(
  options: {
    id?: string | null
    configDir?: string
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    homeDir?: string
  } = {},
): SelectedLocalCliRuntime | null {
  const configDir = options.configDir ?? process.env.BEYA_CONFIG_DIR ?? path.join(os.homedir(), '.beya')
  const settingsPath = path.join(configDir, 'settings.json')
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    return selectedRuntimeFromSettings(normalizeLocalCliSettings(raw[LOCAL_CLI_SETTINGS_KEY]), options)
  } catch {
    return null
  }
}

export function resolveSelectedLocalCliPathSync(
  options: {
    configDir?: string
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    homeDir?: string
  } = {},
): string | null {
  return resolveSelectedLocalCliRuntimeSync(options)?.launchPath ?? null
}

export class LocalCliRuntimeService {
  private settingsService: SettingsService
  private detectVersions: boolean

  constructor(
    options: {
      settingsService?: SettingsService
      detectVersions?: boolean
    } = {},
  ) {
    this.settingsService = options.settingsService ?? new SettingsService()
    this.detectVersions = options.detectVersions ?? true
  }

  async listLocalClis(): Promise<LocalCliRuntimeList> {
    const settings = await this.readRuntimeSettings()
    const detected = await Promise.allSettled(
      KNOWN_CLIS.map((definition) => this.detectCli(definition, settings)),
    )
    const clis = [] as LocalCliRuntimeInfo[]
    for (const [index, entry] of detected.entries()) {
      if (entry.status === 'fulfilled') {
        clis.push(entry.value)
        continue
      }
      const definition = KNOWN_CLIS[index]
      if (definition) {
        console.warn(
          `[LocalCli] Failed to detect ${definition.id} cli`,
          entry.reason,
        )
      }
    }
    const activeId = settings.activeId && clis.some((cli) => cli.id === settings.activeId && cli.available)
      ? settings.activeId
      : null

    return { activeId, clis }
  }

  async activateLocalCli(id: string | null): Promise<LocalCliRuntimeList> {
    if (id === null) {
      const settings = await this.readRuntimeSettings()
      await this.writeRuntimeSettings({ ...settings, activeId: null })
      return this.listLocalClis()
    }

    const definition = knownCliById(id)
    if (!definition) {
      throw ApiError.notFound(`Local CLI not found: ${id}`)
    }

    const settings = await this.readRuntimeSettings()
    await this.writeRuntimeSettings({
      ...settings,
      activeId: id,
    })
    return this.listLocalClis()
  }

  async testLocalCli(id: string): Promise<LocalCliTestResult> {
    const definition = knownCliById(id)
    if (!definition) {
      throw ApiError.notFound(`Local CLI not found: ${id}`)
    }

    const startedAt = Date.now()
    const settings = await this.readRuntimeSettings()
    const candidate = collectCandidates(definition, settings)[0]
    const launch = resolveLaunchPath(definition, candidate)
    if (!candidate || !launch.launchPath) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt,
        version: null,
        executablePath: candidate?.filePath ?? null,
        launchPath: launch.launchPath,
        error: `Local CLI is not available: ${id}`,
      }
    }

    const version = await detectVersion(launch.launchPath)
    return {
      success: true,
      latencyMs: Date.now() - startedAt,
      version,
      executablePath: candidate.filePath,
      launchPath: launch.launchPath,
    }
  }

  async updateLocalCliConfig(
    id: string,
    patch: Record<string, unknown> | UpdateLocalCliRuntimeInput,
  ): Promise<LocalCliRuntimeList> {
    const definition = knownCliById(id)
    if (!definition) {
      throw ApiError.notFound(`Local CLI not found: ${id}`)
    }

    const settings = await this.readRuntimeSettings()
    const current = settings.configs[id] ?? {}
    const rawConfig = isRecord(patch) && isRecord(patch.config)
      ? patch.config
      : patch
    const next = sanitizeCliConfig(definition, {
      ...current,
      ...rawConfig,
    })
    const configs = { ...settings.configs }
    if (Object.keys(next).length > 0) {
      configs[id] = next
    } else {
      delete configs[id]
    }

    const modelRoles = { ...settings.modelRoles }
    if (isRecord(patch) && 'modelRoles' in patch) {
      if (patch.modelRoles === null) {
        delete modelRoles[id]
      } else {
        modelRoles[id] = sanitizeModelRoles(
          patch.modelRoles,
          createDefaultModelRoles(definition),
        )
      }
    }

    const autoCompactWindows = { ...settings.autoCompactWindows }
    if (isRecord(patch) && 'autoCompactWindow' in patch) {
      const window = sanitizeAutoCompactWindow(patch.autoCompactWindow)
      if (window === undefined) {
        delete autoCompactWindows[id]
      } else {
        autoCompactWindows[id] = window
      }
    }

    const modelContextWindows = { ...settings.modelContextWindows }
    if (isRecord(patch) && 'modelContextWindows' in patch) {
      const windows = sanitizeModelContextWindows(patch.modelContextWindows)
      if (windows) {
        modelContextWindows[id] = windows
      } else {
        delete modelContextWindows[id]
      }
    }

    await this.writeRuntimeSettings({
      ...settings,
      configs,
      modelRoles,
      autoCompactWindows,
      modelContextWindows,
    })
    return this.listLocalClis()
  }

  private async readRuntimeSettings(): Promise<LocalCliRuntimeSettings> {
    const settings = await this.settingsService.getUserSettings()
    return normalizeLocalCliSettings(settings[LOCAL_CLI_SETTINGS_KEY])
  }

  private async writeRuntimeSettings(settings: LocalCliRuntimeSettings): Promise<void> {
    await this.settingsService.updateUserSettings({
      [LOCAL_CLI_SETTINGS_KEY]: settings,
    })
  }

  private async detectCli(
    definition: KnownCliDefinition,
    settings: LocalCliRuntimeSettings,
  ): Promise<LocalCliRuntimeInfo> {
    const candidate = collectCandidates(definition, settings)[0]
    const launch = resolveLaunchPath(definition, candidate)
    const available = Boolean(candidate && launch.launchPath)
    const models = available
      ? await scanCliModels(definition, launch.launchPath)
      : []
    const modelRoles = settings.modelRoles[definition.id] ?? createDefaultModelRoles(definition)
    const enabledModels = [...new Set([
      ...Object.values(modelRoles).filter(Boolean),
      ...models.map((model) => model.id),
    ])]
    return {
      id: definition.id,
      displayName: definition.displayName,
      command: definition.commands[0] ?? definition.id,
      executablePath: candidate?.filePath ?? null,
      launchPath: launch.launchPath,
      launchKind: launch.launchKind,
      source: candidate?.source ?? null,
      available,
      supportsDesktopRuntime: true,
      version: launch.launchPath && this.detectVersions
        ? await detectVersion(launch.launchPath)
        : null,
      config: settings.configs[definition.id] ?? {},
      models,
      modelRoles,
      enabledModels,
      ...(settings.autoCompactWindows[definition.id] !== undefined
        ? { autoCompactWindow: settings.autoCompactWindows[definition.id] }
        : {}),
      ...(settings.modelContextWindows[definition.id]
        ? { modelContextWindows: settings.modelContextWindows[definition.id] }
        : {}),
      ...(definition.installUrl ? { installUrl: definition.installUrl } : {}),
      ...(definition.docsUrl ? { docsUrl: definition.docsUrl } : {}),
      ...(launch.diagnostic ? { diagnostic: launch.diagnostic } : {}),
    }
  }
}

export const localCliRuntimeService = new LocalCliRuntimeService()
