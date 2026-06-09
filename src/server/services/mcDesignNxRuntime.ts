import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
import type { JsonObject } from '../types/serverRuntime.js'

const execFileAsync = promisify(execFile)

export type NxInstallation = {
  nxBaseDir: string
  executablePath: string
  ugiiDir?: string
  nxbinDir?: string
  source: string
  confidence: number
  pluginDir?: string
  customDirFile?: string
}

export type NxProcessInfo = {
  pid: number
  name: string
  executablePath?: string
  commandLine?: string
}

export type NxPluginStatus = {
  ok: boolean
  baseUrl: string
  health?: unknown
  tools?: unknown
  error?: string
}

export type NxExpressionFilterResult = {
  expressions: JsonObject[]
  filteredOut: JsonObject[]
  notes: Array<{
    std_id?: unknown
    equation?: unknown
    uncertainty: string
  }>
}

export type NxRuntimeOptions = {
  referenceRoot?: string
  extraRoots?: string[]
  baseUrl?: string
  port?: number
  requestTimeoutMs?: number
  writeTimeoutMs?: number
}

export const DEFAULT_NX_PLUGIN_PORT = 8088
const NX_PLUGIN_READ_TIMEOUT_MS = 30_000
const NX_PLUGIN_WRITE_TIMEOUT_MS = 120_000
const NX_PLUGIN_OPTIMIZATION_TIMEOUT_MS = 300_000

const PROJECT_ROOT = resolve(import.meta.dir, '../../..')
const DEFAULT_MC_DESIGN_REFERENCE_ROOT = join(
  PROJECT_ROOT,
  'runtime',
  'mc-design',
)
const PROJECT_NX_PLUGIN_RELATIVE_DIR = 'runtime/mc-design/dependencies/nx-plugin'
const NX_MARKER_BEGIN = '# MC Design Client BEGIN'
const NX_MARKER_END = '# MC Design Client END'
const NX_CUSTOM_FILE_NAME = 'custom_dirs.dat'
const REQUIRED_PROJECT_NX_PLUGIN_FILES = [
  'startup/NXServer.dll',
  'startup/test_menu.men',
  'startup/test_rbn.rtb',
  'tools/NXTools.dll',
  'sdk/NXSDK.dll',
]

const NX_MANIFEST_PATH = join(PROJECT_ROOT, 'runtime', 'mc-design', 'dependencies', 'resources', 'nx_tools_manifest.json')

type NxToolManifestEntry = {
  name: string
  namespace: string
  source: string
  description: string
  danger_level: string
  requires_connection: boolean
  original_name: string
  category: string
  parameters: Array<{ name: string; type: string; isOptional: boolean }>
  input_schema: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
}

type NxToolManifest = {
  generated_by: string
  registration_time: string
  tools: NxToolManifestEntry[]
}

let cachedManifest: NxToolManifest | null = null

function loadNxToolManifest(): NxToolManifest {
  if (cachedManifest) return cachedManifest
  if (!existsSync(NX_MANIFEST_PATH)) {
    cachedManifest = { generated_by: 'fallback', registration_time: 'unknown', tools: [] }
    return cachedManifest
  }
  try {
    const raw = JSON.parse(readFileSync(NX_MANIFEST_PATH, 'utf8')) as unknown
    cachedManifest = {
      generated_by: String((raw as Record<string, unknown>).generated_by ?? 'unknown'),
      registration_time: String((raw as Record<string, unknown>).registration_time ?? 'unknown'),
      tools: Array.isArray((raw as Record<string, unknown>).tools)
        ? ((raw as Record<string, unknown>).tools as Array<Record<string, unknown>>).map(t => ({
          name: String(t.name ?? ''),
          namespace: String(t.namespace ?? ''),
          source: String(t.source ?? ''),
          description: String(t.description ?? ''),
          danger_level: String(t.danger_level ?? 'read'),
          requires_connection: Boolean(t.requires_connection),
          original_name: String(t.original_name ?? ''),
          category: String(t.category ?? ''),
          parameters: Array.isArray(t.parameters)
            ? (t.parameters as Array<Record<string, unknown>>).map(p => ({
              name: String(p.name ?? ''),
              type: String(p.type ?? ''),
              isOptional: Boolean(p.isOptional),
            }))
            : [],
          input_schema: {
            type: 'object',
            properties: (t.input_schema as Record<string, unknown>)?.properties as Record<string, unknown> ?? {},
            required: Array.isArray((t.input_schema as Record<string, unknown>)?.required)
              ? ((t.input_schema as Record<string, unknown>).required as string[])
              : undefined,
          },
        }))
        : [],
    }
    return cachedManifest
  } catch {
    cachedManifest = { generated_by: 'fallback', registration_time: 'unknown', tools: [] }
    return cachedManifest
  }
}

export function getNxToolCatalog(): string {
  const manifest = loadNxToolManifest()
  if (manifest.tools.length === 0) return ''

  const lines: string[] = ['## 可用 NX Plugin 工具', '']
  for (const tool of manifest.tools) {
    const required = tool.parameters.filter(p => !p.isOptional).map(p => `${p.name}: ${p.type}`).join(', ')
    const optional = tool.parameters.filter(p => p.isOptional).map(p => `${p.name}: ${p.type}`).join(', ')
    const params = [
      required ? `必填(${required})` : '',
      optional ? `可选(${optional})` : '',
    ].filter(Boolean).join(' ')

    lines.push(`- \`${tool.name}\` (→ ${tool.original_name}) ${tool.description}。参数: ${params || '无参数'}。危险级别: ${tool.danger_level}`)
  }

  return lines.join('\n')
}

export function getNxToolNames(): string[] {
  return loadNxToolManifest().tools.map(t => t.name)
}

const NX_TOOL_NAME_MAP: Record<string, string> = {
  nx_test: 'Test',
  nx_get_work_part_info: 'GetWorkPartInfo',
  nx_get_drive_params_list: 'GetDriveParamsList',
  nx_get_all_params_list: 'GetAllParamsList',
  nx_find_params: 'FindParams',
  nx_update_param: 'UpdateParam',
  nx_batch_update_params: 'BatchUpdateParams',
  nx_create_param: 'CreateParam',
  nx_open_part: 'OpenPart',
  nx_open_tcpart: 'OpenTCPart',
  nx_open_tc_drawing: 'OpenTcDrawing',
  nx_get_drawing_sheet_name_list: 'GetDrawingSheetNameList',
  nx_open_drawing_sheet: 'OpenDrawingSheet',
  nx_update_drawings: 'Updatedrawings',
  nx_create_image: 'CreateImage',
  nx_create_new_part: 'CreateNewPart',
  nx_fit_view: 'FitView',
  nx_switch_view: 'SwitchView',
  nx_get_all_view_names: 'GetAllViewNames',
  nx_get_view_style: 'GetViewStyle',
  nx_set_view_style: 'SetViewStyle',
  nx_rotate_and_scale_view: 'RotateAndScaleView',
  nx_high_light_dim: 'HighLightDim',
  nx_exit_animation: 'ExitAnimation',
  nx_get_optimization_tool_guide: 'GetOptimizationToolGuide',
  nx_validate_optimization_study: 'ValidateOptimizationStudy',
  nx_build_optimization_objective_expression: 'BuildOptimizationObjectiveExpression',
  nx_run_optimization_study: 'RunOptimizationStudy',
  nx_fs_exists: 'fs_exists',
  nx_fs_read_bytes: 'fs_read_bytes',
  nx_fs_write_bytes: 'fs_write_bytes',
  nx_fs_copy: 'fs_copy',
}

const NX_PARAM_ALIASES: Record<string, string> = {
  part_path: 'path',
  partPath: 'path',
  file_path: 'path',
  prt_path: 'path',
  prtPath: 'path',
  item_id: 'itemID',
  itemId: 'itemID',
  itemid: 'itemID',
  item_rev: 'itemRev',
  itemRev: 'itemRev',
  itemrev: 'itemRev',
  draw_sheet_name: 'drawSheetName',
  drawSheetNameAlias: 'drawSheetName',
  sheet_name: 'drawSheetName',
  sheetName: 'drawSheetName',
  image_path: 'filePath',
  imagePath: 'filePath',
  img_path: 'filePath',
  output_path: 'filePath',
  outputPath: 'filePath',
  view_name: 'view_name',
  viewName: 'view_name',
  style_type: 'style_type',
  styleType: 'style_type',
  std_id: 'std_id',
  stdId: 'std_id',
  stdid: 'std_id',
  param_name: 'std_id',
  paramName: 'std_id',
  exp_name: 'expName',
  expNameAlias: 'expName',
  is_high_asso: 'isHighAssoOBjI',
  highAsso: 'isHighAssoOBjI',
  folder_path: 'folder_path',
  folderPath: 'folder_path',
  folder: 'folder_path',
  part_name: 'part_name',
  partName: 'part_name',
  expression_list: 'expressions',
  expressionList: 'expressions',
  params: 'expressions',
  updates: 'expressions',
  src_path: 'src_path',
  srcPath: 'src_path',
  source: 'src_path',
  dst_path: 'dst_path',
  dstPath: 'dst_path',
  dest: 'dst_path',
  target: 'dst_path',
  base64: 'base64',
  data: 'base64',
  bytes: 'base64',
  overwrite: 'overwrite',
}

const WRITE_NX_TOOLS = new Set([
  'BatchUpdateParams',
  'BuildOptimizationObjectiveExpression',
  'CreateImage',
  'CreateNewPart',
  'CreateParam',
  'EnterDraftingEnvironment',
  'ExitAnimation',
  'HighLightDim',
  'OpenDrawingSheet',
  'OpenPart',
  'OpenTCPart',
  'OpenTcDrawing',
  'RunOptimizationStudy',
  'Updatedrawings',
  'UpdateParam',
  'fs_copy',
  'fs_write_bytes',
])

const SLOW_NX_WRITE_TOOL_TIMEOUTS: Record<string, number> = {
  BatchUpdateParams: NX_PLUGIN_WRITE_TIMEOUT_MS,
  BuildOptimizationObjectiveExpression: NX_PLUGIN_WRITE_TIMEOUT_MS,
  CreateImage: NX_PLUGIN_WRITE_TIMEOUT_MS,
  OpenDrawingSheet: NX_PLUGIN_WRITE_TIMEOUT_MS,
  OpenPart: NX_PLUGIN_WRITE_TIMEOUT_MS,
  OpenTCPart: NX_PLUGIN_WRITE_TIMEOUT_MS,
  OpenTcDrawing: NX_PLUGIN_WRITE_TIMEOUT_MS,
  RunOptimizationStudy: NX_PLUGIN_OPTIMIZATION_TIMEOUT_MS,
  Updatedrawings: NX_PLUGIN_WRITE_TIMEOUT_MS,
  UpdateParam: NX_PLUGIN_WRITE_TIMEOUT_MS,
}

const openedNxPidsBySession = new Map<string, Set<number>>()

export async function discoverNxInstallations(
  options: NxRuntimeOptions = {},
): Promise<NxInstallation[]> {
  const candidates: NxInstallation[] = []
  const processes = await listNxProcesses()

  for (const processInfo of processes) {
    if (processInfo.executablePath) {
      candidates.push(await installationFromExecutable(
        processInfo.executablePath,
        'running_process',
        100,
      ))
    }
  }

  for (const executablePath of directExecutableCandidates()) {
    candidates.push(await installationFromExecutable(
      executablePath,
      'environment',
      95,
    ))
  }

  for (const root of await historyReferenceRoots(options)) {
    candidates.push(...await installationsFromHistory(root))
  }

  for (const root of await commonNxRoots(options)) {
    candidates.push(...await installationsFromRoot(root))
  }

  const existing: NxInstallation[] = []
  for (const candidate of candidates) {
    if (await pathExists(candidate.executablePath)) {
      existing.push(candidate)
    }
  }
  return dedupeInstallations(existing)
    .sort((a, b) => b.confidence - a.confidence)
}

export async function listNxProcesses(): Promise<NxProcessInfo[]> {
  if (process.platform !== 'win32') return []
  const fromGetProcess = await listNxProcessesFromGetProcess()
  if (fromGetProcess.length > 0) return fromGetProcess
  const fromCim = await listNxProcessesFromCim()
  if (fromCim.length > 0) return fromCim
  return await listNxProcessesFromTasklist()
}

async function listNxProcessesFromCim(): Promise<NxProcessInfo[]> {
  const script = [
    "$items = Get-CimInstance Win32_Process -Filter \"Name='ugraf.exe'\"",
    'if ($null -eq $items) { @() | ConvertTo-Json -Compress; exit }',
    '$items | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
  ].join('; ')
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], { windowsHide: true, timeout: 5000 })
    return parsePowerShellProcessJson(stdout, {
      pidKey: 'ProcessId',
      nameKey: 'Name',
      pathKey: 'ExecutablePath',
      commandLineKey: 'CommandLine',
    })
  } catch {
    return []
  }
}

async function listNxProcessesFromGetProcess(): Promise<NxProcessInfo[]> {
  const script = [
    "$items = Get-Process -Name ugraf -ErrorAction SilentlyContinue",
    'if ($null -eq $items) { @() | ConvertTo-Json -Compress; exit }',
    '$items | Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress',
  ].join('; ')
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], { windowsHide: true, timeout: 5000 })
    return parsePowerShellProcessJson(stdout, {
      pidKey: 'Id',
      nameKey: 'ProcessName',
      pathKey: 'Path',
    })
  } catch {
    return []
  }
}

async function listNxProcessesFromTasklist(): Promise<NxProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('tasklist.exe', [
      '/FI',
      'IMAGENAME eq ugraf.exe',
      '/FO',
      'CSV',
      '/NH',
    ], { windowsHide: true, timeout: 5000 })
    return stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.includes('INFO:'))
      .map(parseTasklistCsvLine)
      .filter((item): item is NxProcessInfo => item !== null)
  } catch {
    return []
  }
}

function parsePowerShellProcessJson(
  stdout: string,
  keys: { pidKey: string; nameKey: string; pathKey?: string; commandLineKey?: string },
): NxProcessInfo[] {
  const parsed = JSON.parse(stdout.trim() || '[]') as unknown
  const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  return items
    .map(item => item && typeof item === 'object'
      ? item as Record<string, unknown>
      : null)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map(item => ({
      pid: Number(item[keys.pidKey]),
      name: normalizeNxProcessName(stringField(item[keys.nameKey])),
      executablePath: keys.pathKey ? stringField(item[keys.pathKey]) : undefined,
      commandLine: keys.commandLineKey ? stringField(item[keys.commandLineKey]) : undefined,
    }))
    .filter(item => Number.isFinite(item.pid))
}

function parseTasklistCsvLine(line: string): NxProcessInfo | null {
  const fields = line.match(/("([^"]|"")*"|[^,]+)/g)?.map(field =>
    field.replace(/^"|"$/g, '').replace(/""/g, '"'),
  ) ?? []
  const imageName = fields[0]
  const pid = Number(fields[1])
  if (!imageName || !Number.isFinite(pid) || !/^ugraf\.exe$/i.test(imageName)) return null
  return { pid, name: 'ugraf.exe' }
}

function normalizeNxProcessName(name: string | undefined): string {
  if (!name) return 'ugraf.exe'
  return /\.exe$/i.test(name) ? name : `${name}.exe`
}

export async function openNx(
  options: NxRuntimeOptions & {
    executablePath?: string
    partPath?: string
    waitSeconds?: number
    sessionId?: string
    reuseRunning?: boolean
  } = {},
): Promise<JsonObject> {
  const before = await listNxProcesses()
  if (shouldReuseRunningNx(before, options)) {
    return {
      ok: true,
      alreadyRunning: true,
      partPath: options.partPath,
      partOpenRequired: Boolean(options.partPath),
      runningProcesses: before,
      message: options.partPath
        ? 'NX is already running; reuse the existing process and open the part through the NX plugin.'
        : 'NX is already running; no new ugraf.exe process was launched.',
    }
  }
  const pluginStatus = await getNxPluginStatus(options)
  if (pluginStatus.ok) {
    return {
      ok: true,
      alreadyRunning: true,
      detectedBy: 'nx_plugin_health',
      partPath: options.partPath,
      partOpenRequired: Boolean(options.partPath),
      runningProcesses: before,
      pluginStatus,
      message: options.partPath
        ? 'NX plugin is already online; reuse the existing NX session and open the part through the NX plugin.'
        : 'NX plugin is already online; no new ugraf.exe process was launched.',
    }
  }
  const install = options.executablePath
    ? await installationFromExecutable(options.executablePath, 'explicit', 100)
    : (await discoverNxInstallations(options))[0]
  if (!install) {
    return {
      ok: false,
      error: 'NX_NOT_FOUND',
      message: '未找到可执行的 ugraf.exe。',
    }
  }

  const args = options.partPath ? [options.partPath] : []
  const child = spawn(install.executablePath, args, {
    cwd: dirname(install.executablePath),
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
  if (child.pid && options.sessionId) {
    recordOpenedPid(options.sessionId, child.pid)
  }

  const waitSeconds = Math.max(0, Math.min(options.waitSeconds ?? 20, 120))
  const processes = await waitForNxProcesses(before, waitSeconds)

  return {
    ok: processes.length > 0,
    launchedPid: child.pid,
    executablePath: install.executablePath,
    partPath: options.partPath,
    runningProcesses: processes,
    message: processes.length > 0
      ? 'NX 已启动或已检测到正在运行。'
      : '已发起 NX 启动，但等待时间内未检测到 ugraf.exe。',
  }
}

export function shouldReuseRunningNx(
  runningProcesses: NxProcessInfo[],
  options: { partPath?: string; reuseRunning?: boolean } = {},
): boolean {
  return runningProcesses.length > 0 && options.reuseRunning !== false
}

export async function closeNx(
  options: {
    sessionId?: string
    pids?: number[]
    onlyStartedByTool?: boolean
    force?: boolean
  } = {},
): Promise<JsonObject> {
  const onlyStartedByTool = options.onlyStartedByTool !== false
  const running = await listNxProcesses()
  const tracked = options.sessionId
    ? openedNxPidsBySession.get(options.sessionId) ?? new Set<number>()
    : new Set<number>()
  const pids = options.pids && options.pids.length > 0
    ? options.pids
    : onlyStartedByTool
      ? [...tracked]
      : running.map(item => item.pid)

  if (pids.length === 0) {
    return {
      ok: true,
      closed: [],
      skippedRunningProcesses: running,
      message: onlyStartedByTool
        ? '没有本会话启动的 NX 进程可关闭。'
        : '没有检测到 NX 进程。',
    }
  }

  const closed = []
  for (const pid of pids) {
    closed.push(await closeProcess(pid, options.force === true))
    if (options.sessionId) tracked.delete(pid)
  }

  return {
    ok: closed.every(item => item.ok || item.alreadyExited),
    closed,
    remainingProcesses: await listNxProcesses(),
  }
}

export async function getNxPluginStatus(
  options: NxRuntimeOptions = {},
): Promise<NxPluginStatus> {
  const baseUrl = nxPluginBaseUrl(options)
  try {
    const [health, tools] = await Promise.all([
      fetchNxJson(`${baseUrl}/health`, { method: 'GET' }),
      fetchNxJson(`${baseUrl}/tools`, { method: 'GET' }),
    ])
    const ok = isPluginOk(health)
    return { ok, baseUrl, health, tools }
  } catch (error) {
    return {
      ok: false,
      baseUrl,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function waitForNxPluginStatus(
  options: NxRuntimeOptions & { waitSeconds?: number } = {},
): Promise<NxPluginStatus> {
  const waitSeconds = Math.max(0, Math.min(options.waitSeconds ?? 60, 180))
  const deadline = Date.now() + waitSeconds * 1000
  let latest = await getNxPluginStatus(options)
  while (!latest.ok && Date.now() < deadline) {
    await sleep(1000)
    latest = await getNxPluginStatus(options)
  }
  return latest
}

export async function prepareProjectNxPlugin(
  options: NxRuntimeOptions & {
    executablePath?: string
    pluginDir?: string
    confirmed?: boolean
    write?: boolean
  } = {},
): Promise<JsonObject> {
  const pluginDir = normalize(
    options.pluginDir ?? join(PROJECT_ROOT, PROJECT_NX_PLUGIN_RELATIVE_DIR),
  )
  const pluginFiles = await validateProjectNxPluginFiles(pluginDir)
  if (pluginFiles.missing.length > 0) {
    return {
      ok: false,
      error: 'PROJECT_NX_PLUGIN_INCOMPLETE',
      pluginDir,
      requiredFiles: pluginFiles.required,
      missingFiles: pluginFiles.missing,
    }
  }

  const install = options.executablePath
    ? await installationFromExecutable(options.executablePath, 'explicit', 100)
    : (await discoverNxInstallations(options))[0]
  if (!install) {
    return {
      ok: false,
      error: 'NX_NOT_FOUND',
      pluginDir,
      requiredFiles: pluginFiles.required,
      message: 'No local Siemens NX ugraf.exe was found.',
    }
  }

  const customDirs = await resolveNxCustomDirFile(install.nxBaseDir)
  const existingText = await readOptionalText(customDirs.customDirFile)
  const existingLines = existingText.split(/\r?\n/)
  const registered = hasRegisteredPluginPath(existingLines, pluginDir)
  if (registered) {
    return {
      ok: true,
      mode: 'already_registered',
      pluginDir,
      installation: install,
      customDirs,
      registered: true,
      needsNxRestart: false,
    }
  }

  if (options.write !== true || options.confirmed !== true) {
    return {
      ok: false,
      error: 'NX_PLUGIN_REGISTRATION_REQUIRED',
      pluginDir,
      installation: install,
      customDirs,
      registered: false,
      requiredFiles: pluginFiles.required,
      message:
        'Project NX plugin files are present, but NX custom_dirs.dat does not point at them.',
    }
  }

  const backupPath = existingText
    ? `${customDirs.customDirFile}.beya-mc-design.${timestampSegment()}.bak`
    : undefined
  if (backupPath) {
    await writeFile(backupPath, existingText, 'utf8')
  }

  const lines = stripManagedNxCustomBlock(existingLines)
  if (lines.length > 0) lines.push('')
  lines.push(NX_MARKER_BEGIN, pluginDir, NX_MARKER_END)
  await mkdir(customDirs.menusDir, { recursive: true })
  await writeFile(customDirs.customDirFile, `${lines.join('\r\n')}\r\n`, 'utf8')

  return {
    ok: true,
    mode: 'registered',
    pluginDir,
    installation: install,
    customDirs,
    registered: true,
    backupPath,
    needsNxRestart: (await listNxProcesses()).length > 0,
  }
}

export async function callNxPluginTool(
  toolName: string,
  args: JsonObject = {},
  options: NxRuntimeOptions = {},
): Promise<JsonObject> {
  const originalName = resolveNxToolName(toolName)
  const normalizedArgs = normalizePluginArgs(originalName, args)
  const baseUrl = nxPluginBaseUrl(options)
  if (usesInternalOptimizationObjective(originalName, normalizedArgs)) {
    return {
      ok: false,
      tool: toolName,
      originalTool: originalName,
      baseUrl,
      args: normalizedArgs,
      error: 'invalid_optimization_objective',
      message: 'Objective_AI 是 NX 优化工具内部合成目标表达式，不能作为 objective 再传入运行工具；请传原始表达式目标。',
    }
  }
  const requestTimeoutMs = nxPluginToolTimeoutMs(originalName, options)
  let result: unknown
  try {
    result = await fetchNxJson(`${baseUrl}/tools/${encodeURIComponent(originalName)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(normalizedArgs),
    }, requestTimeoutMs)
  } catch (error) {
    return {
      ok: false,
      tool: toolName,
      originalTool: originalName,
      baseUrl,
      args: normalizedArgs,
      error: error instanceof Error ? error.message : String(error),
      timeout_ms: requestTimeoutMs,
    }
  }
  return {
    ok: isPluginOk(result),
    tool: toolName,
    originalTool: originalName,
    baseUrl,
    args: normalizedArgs,
    result: result as JsonObject,
  }
}

function nxPluginToolTimeoutMs(toolName: string, options: NxRuntimeOptions): number {
  const requestTimeout = coerceTimeoutMs(options.requestTimeoutMs)
  const writeTimeout = coerceTimeoutMs(options.writeTimeoutMs)
  if (!isNxWriteTool(toolName)) return requestTimeout ?? NX_PLUGIN_READ_TIMEOUT_MS
  return writeTimeout
    ?? requestTimeout
    ?? SLOW_NX_WRITE_TOOL_TIMEOUTS[resolveNxToolName(toolName)]
    ?? NX_PLUGIN_WRITE_TIMEOUT_MS
}

function normalizePluginArgs(toolName: string, args: JsonObject): JsonObject {
  const normalized: JsonObject = {}
  for (const [key, raw] of Object.entries(args)) {
    const mappedKey = NX_PARAM_ALIASES[key] ?? NX_PARAM_ALIASES[key.toLowerCase()] ?? key
    let value = raw
    if (typeof value === 'string' && (mappedKey === 'path' || mappedKey === 'filePath' || mappedKey === 'src_path' || mappedKey === 'dst_path')) {
      value = normalizeWindowsPath(value as string)
    }
    if (mappedKey !== key && normalized[mappedKey]) continue
    normalized[mappedKey] = value
  }
  return normalized
}

function normalizeWindowsPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function usesInternalOptimizationObjective(toolName: string, args: JsonObject): boolean {
  if (toolName !== 'RunOptimizationStudy' && toolName !== 'BuildOptimizationObjectiveExpression') {
    return false
  }
  const objectives = args.objectives
  if (!Array.isArray(objectives)) return false
  return objectives.some(objective => {
    if (!objective || typeof objective !== 'object' || Array.isArray(objective)) return false
    const name = String((objective as JsonObject).name ?? '').trim()
    return name.localeCompare('Objective_AI', undefined, { sensitivity: 'accent' }) === 0
      || name.toLowerCase() === 'objective_ai'
  })
}

export function isNxWriteTool(toolName: string): boolean {
  return WRITE_NX_TOOLS.has(resolveNxToolName(toolName))
}

export function resolveNxToolName(toolName: string): string {
  return NX_TOOL_NAME_MAP[toolName] ?? toolName
}

export function mapNxParametersToExpressions(
  targetParameters: JsonObject,
  driveExpressions: unknown,
): Array<{
  paramId: string
  targetValue: unknown
  currentValue?: string
  expression?: JsonObject
  matched: boolean
}> {
  const expressions = extractExpressionList(driveExpressions)
  return Object.entries(targetParameters).map(([paramId, targetValue]) => {
    const expression = expressions.find(candidate =>
      normalized(candidate.std_id) === normalized(paramId) ||
      normalized(parseEquationLeft(candidate.equation)) === normalized(paramId))
    return {
      paramId,
      targetValue,
      currentValue: expression ? parseEquationRight(expression.equation) : undefined,
      expression,
      matched: Boolean(expression),
    }
  })
}

export function filterNxExpressions(
  driveExpressions: unknown,
): NxExpressionFilterResult {
  const expressions = extractExpressionList(driveExpressions)
  const kept: JsonObject[] = []
  const filteredOut: JsonObject[] = []
  const notes: NxExpressionFilterResult['notes'] = []

  for (const expression of expressions) {
    const stdId = String(expression.std_id ?? '')
    const equation = String(expression.equation ?? '')
    const left = parseEquationLeft(equation) || stdId
    const isAnonymous = /^p\d+$/i.test(stdId) || /^p\d+$/i.test(left)
    if (!isAnonymous) {
      kept.push(expression)
      continue
    }

    const relatedStandardParams = extractStandardParamIds(equation)
      .filter(paramId => !/^p\d+$/i.test(paramId))
    if (relatedStandardParams.length > 0) {
      kept.push({
        ...expression,
        uncertainty: 'anonymous_expression_related_to_standard_parameters',
        relatedStandardParams,
      })
      notes.push({
        std_id: expression.std_id,
        equation: expression.equation,
        uncertainty:
          `Anonymous expression is retained because it references ${relatedStandardParams.join(', ')}.`,
      })
      continue
    }

    filteredOut.push({
      ...expression,
      filterReason: 'isolated_anonymous_expression',
    })
  }

  return { expressions: kept, filteredOut, notes }
}

export function sameValueBatchUpdates(
  mappings: ReturnType<typeof mapNxParametersToExpressions>,
  limit = 3,
): Array<{ std_id: string; value: string }> {
  return mappings
    .filter(mapping => mapping.matched && mapping.currentValue !== undefined)
    .slice(0, limit)
    .map(mapping => ({
      std_id: mapping.paramId,
      value: String(mapping.currentValue),
    }))
}

function extractExpressionList(value: unknown): JsonObject[] {
  const root = value && typeof value === 'object'
    ? value as JsonObject
    : {}
  const nested = root.result && typeof root.result === 'object'
    ? root.result as JsonObject
    : root
  const data = nested.data && typeof nested.data === 'object'
    ? nested.data as JsonObject
    : nested
  const expressions = data.expressions
  return Array.isArray(expressions)
    ? expressions.filter((item): item is JsonObject =>
      item !== null && typeof item === 'object' && !Array.isArray(item))
    : []
}

function parseEquationLeft(value: unknown): string {
  const text = String(value ?? '')
  const index = text.indexOf('=')
  return index >= 0 ? text.slice(0, index).trim() : text.trim()
}

function parseEquationRight(value: unknown): string | undefined {
  const text = String(value ?? '')
  const index = text.indexOf('=')
  if (index < 0) return undefined
  return text.slice(index + 1).trim()
}

function extractStandardParamIds(value: string): string[] {
  const matches = value.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g) ?? []
  return [...new Set(matches)]
}

async function closeProcess(
  pid: number,
  force: boolean,
): Promise<JsonObject> {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid)
      return { pid, ok: true }
    } catch (error) {
      return {
        pid,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const forceScript = force
    ? 'if ($p -and -not $p.HasExited) { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue }'
    : ''
  const script = [
    `$pid = ${Math.trunc(pid)}`,
    '$p = Get-Process -Id $pid -ErrorAction SilentlyContinue',
    'if ($null -eq $p) { @{ pid = $pid; ok = $true; alreadyExited = $true } | ConvertTo-Json -Compress; exit }',
    '$closed = $p.CloseMainWindow()',
    'Start-Sleep -Milliseconds 1500',
    '$p = Get-Process -Id $pid -ErrorAction SilentlyContinue',
    forceScript,
    '$p = Get-Process -Id $pid -ErrorAction SilentlyContinue',
    '@{ pid = $pid; ok = ($null -eq $p); closeMainWindow = $closed; force = ' +
      (force ? '$true' : '$false') +
      ' } | ConvertTo-Json -Compress',
  ].filter(Boolean).join('; ')

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], { windowsHide: true, timeout: 8000 })
    return JSON.parse(stdout.trim() || '{}') as JsonObject
  } catch (error) {
    return {
      pid,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function waitForNxProcesses(
  before: NxProcessInfo[],
  waitSeconds: number,
): Promise<NxProcessInfo[]> {
  const beforePids = new Set(before.map(item => item.pid))
  const deadline = Date.now() + waitSeconds * 1000
  let latest = await listNxProcesses()
  while (Date.now() < deadline) {
    if (latest.length > 0) return latest
    await sleep(1000)
    latest = await listNxProcesses()
  }
  const after = latest.filter(item => !beforePids.has(item.pid))
  return after.length > 0 ? after : latest
}

function recordOpenedPid(sessionId: string, pid: number): void {
  const current = openedNxPidsBySession.get(sessionId) ?? new Set<number>()
  current.add(pid)
  openedNxPidsBySession.set(sessionId, current)
}

async function installationsFromHistory(root: string): Promise<NxInstallation[]> {
  const installStatePath = join(root, 'client', 'install-state.json')
  try {
    const raw = await readFile(installStatePath, 'utf8')
    const parsed = JSON.parse(raw) as {
      nx_custom_dir?: {
        nx_base_dir?: string
        ugii_dir?: string
        custom_dir_file?: string
        plugin_dir?: string
      }
    }
    const nx = parsed.nx_custom_dir
    if (!nx?.nx_base_dir) return []
    return [
      await installationFromBaseDir(nx.nx_base_dir, 'mc_design_install_state', 90, {
        ugiiDir: nx.ugii_dir,
        customDirFile: nx.custom_dir_file,
        pluginDir: nx.plugin_dir,
      }),
    ]
  } catch {
    return []
  }
}

async function installationsFromRoot(root: string): Promise<NxInstallation[]> {
  const out: NxInstallation[] = []
  const direct = await installationFromBaseDir(root, 'common_root', 60)
  if (await pathExists(direct.executablePath)) out.push(direct)

  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/nx|siemens/i.test(entry.name)) continue
    const candidate = await installationFromBaseDir(
      join(root, entry.name),
      'common_root',
      55,
    )
    if (await pathExists(candidate.executablePath)) out.push(candidate)
  }
  return out
}

async function installationFromExecutable(
  executablePath: string,
  source: string,
  confidence: number,
): Promise<NxInstallation> {
  const normalizedPath = normalize(executablePath)
  const parent = dirname(normalizedPath)
  const parentName = parent.split(/[\\/]/).pop()?.toUpperCase()
  const baseDir = parentName === 'NXBIN' || parentName === 'UGII'
    ? dirname(parent)
    : parent
  return installationFromBaseDir(baseDir, source, confidence, {
    executablePath: normalizedPath,
  })
}

async function installationFromBaseDir(
  nxBaseDir: string,
  source: string,
  confidence: number,
  extras: Partial<NxInstallation> = {},
): Promise<NxInstallation> {
  const nxbinExe = join(nxBaseDir, 'NXBIN', 'ugraf.exe')
  const ugiiExe = join(nxBaseDir, 'UGII', 'ugraf.exe')
  const executablePath =
    extras.executablePath ??
    (await pathExists(nxbinExe) ? nxbinExe : ugiiExe)
  return {
    nxBaseDir: normalize(nxBaseDir),
    executablePath: normalize(executablePath),
    nxbinDir: join(nxBaseDir, 'NXBIN'),
    ugiiDir: extras.ugiiDir ?? join(nxBaseDir, 'UGII'),
    source,
    confidence,
    pluginDir: extras.pluginDir,
    customDirFile: extras.customDirFile,
  }
}

async function resolveNxCustomDirFile(nxBaseDir: string): Promise<{
  ugiiDir: string
  menusDir: string
  customDirFile: string
}> {
  const base = resolve(nxBaseDir)
  const candidates = base.split(/[\\/]/).pop()?.toUpperCase() === 'UGII'
    ? [base, join(dirname(base), 'UGII')]
    : [join(base, 'UGII'), base]
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate)
    const key = normalizedCandidate.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (await pathExists(normalizedCandidate)) {
      const menusDir = join(normalizedCandidate, 'menus')
      return {
        ugiiDir: normalizedCandidate,
        menusDir,
        customDirFile: join(menusDir, NX_CUSTOM_FILE_NAME),
      }
    }
  }
  const fallback = normalize(candidates[0] ?? join(base, 'UGII'))
  const menusDir = join(fallback, 'menus')
  return {
    ugiiDir: fallback,
    menusDir,
    customDirFile: join(menusDir, NX_CUSTOM_FILE_NAME),
  }
}

function dedupeInstallations(candidates: NxInstallation[]): NxInstallation[] {
  const byExe = new Map<string, NxInstallation>()
  for (const candidate of candidates) {
    const key = candidate.executablePath.toLowerCase()
    const previous = byExe.get(key)
    if (!previous || previous.confidence < candidate.confidence) {
      byExe.set(key, {
        ...previous,
        ...candidate,
        source: previous && previous.source !== candidate.source
          ? `${previous.source},${candidate.source}`
          : candidate.source,
        confidence: Math.max(previous?.confidence ?? 0, candidate.confidence),
      })
    }
  }
  return [...byExe.values()]
}

async function historyReferenceRoots(options: NxRuntimeOptions): Promise<string[]> {
  const roots = [
    options.referenceRoot,
    process.env.MC_DESIGN_REFERENCE_ROOT,
    process.env.MC_DESIGN_LEGACY_ROOT,
    DEFAULT_MC_DESIGN_REFERENCE_ROOT,
  ].filter((entry): entry is string => Boolean(entry))
  const existing = []
  for (const root of roots) {
    if (await pathExists(root)) existing.push(root)
  }
  return [...new Set(existing.map(root => normalize(root)))]
}

async function commonNxRoots(options: NxRuntimeOptions): Promise<string[]> {
  const roots = [
    ...(options.extraRoots ?? []),
    process.env.UGII_BASE_DIR,
    process.env.NX_BASE_DIR,
    process.env.NX_ROOT,
    'C:\\Siemens',
    'D:\\Siemens',
    'E:\\Siemens',
    'F:\\Siemens',
    'C:\\Program Files\\Siemens',
    'C:\\Program Files (x86)\\Siemens',
  ].filter((entry): entry is string => Boolean(entry))
  const existing = []
  for (const root of roots) {
    if (await pathExists(root)) existing.push(root)
  }
  return [...new Set(existing.map(root => normalize(root)))]
}

function directExecutableCandidates(): string[] {
  return [
    process.env.UGRAF_EXE,
    process.env.NX_UGRAF,
    process.env.BEYA_NX_UGRAF,
  ].filter((entry): entry is string => Boolean(entry))
}

function nxPluginBaseUrl(options: NxRuntimeOptions): string {
  if (options.baseUrl) return options.baseUrl.replace(/\/$/, '')
  const port = options.port ??
    (Number(process.env.MC_DESIGN_NX_PLUGIN_PORT) || DEFAULT_NX_PLUGIN_PORT)
  return `http://127.0.0.1:${port}/api`
}

async function fetchNxJson(
  url: string,
  init: RequestInit,
  timeoutMs = NX_PLUGIN_READ_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) as unknown : {}
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text}`)
    }
    return payload
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`NX plugin request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function coerceTimeoutMs(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.min(parsed, 600_000) : undefined
}

async function validateProjectNxPluginFiles(pluginDir: string): Promise<{
  required: string[]
  missing: string[]
}> {
  const required = REQUIRED_PROJECT_NX_PLUGIN_FILES.map(relativePath =>
    join(pluginDir, relativePath),
  )
  const missing = []
  for (const file of required) {
    if (!await pathExists(file)) missing.push(file)
  }
  return { required, missing }
}

function hasRegisteredPluginPath(lines: string[], pluginDir: string): boolean {
  const normalizedPluginDir = normalizePathForCompare(pluginDir)
  return lines.some(line =>
    normalizePathForCompare(line.trim()) === normalizedPluginDir)
}

function stripManagedNxCustomBlock(lines: string[]): string[] {
  const result: string[] = []
  let inBlock = false
  for (const line of lines) {
    const stripped = line.trim()
    if (stripped === NX_MARKER_BEGIN) {
      inBlock = true
      continue
    }
    if (stripped === NX_MARKER_END) {
      inBlock = false
      continue
    }
    if (!inBlock) result.push(line.replace(/\r$/, ''))
  }
  while (result.length > 0 && !result[result.length - 1]?.trim()) {
    result.pop()
  }
  return result
}

async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

function isPluginOk(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const object = value as { ok?: unknown }
  return object.ok === true
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(resolve(path))
    return true
  } catch {
    return false
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalized(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '')
}

function normalizePathForCompare(path: string): string {
  return normalize(path).replace(/[\\/]+$/, '').toLowerCase()
}

function timestampSegment(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
