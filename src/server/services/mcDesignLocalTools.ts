import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { JsonObject, ToolCallExtra, ToolDefinition } from '../types/serverRuntime.js'
import {
  MC_DESIGN_KNOWLEDGE,
  MC_DESIGN_LOCAL_SOURCE,
  MC_DESIGN_RUNTIME_ROOT,
  MC_DESIGN_TASKS,
  MC_DESIGN_TEMPLATES,
  getMcDesignTask,
  getMcDesignTemplate,
  type McDesignComponent,
  type McDesignTask,
  type McDesignTemplate,
} from './mcDesignLocalData.js'
import {
  callNxPluginTool,
  closeNx,
  discoverNxInstallations,
  getNxPluginStatus,
  isNxWriteTool,
  listNxProcesses,
  mapNxParametersToExpressions,
  openNx,
  prepareProjectNxPlugin,
  resolveNxToolName,
  sameValueBatchUpdates,
} from './mcDesignNxRuntime.js'

type WorkflowIntent =
  | 'guided_design'
  | 'task_execution'
  | 'retrieval_comparison'
  | 'parameter_modeling'
  | 'direct_parameter_update'
  | 'performance_design'
  | 'report_generation'
  | 'dfmea_generation'
  | 'drawing_template_update'
  | 'optimization'
  | 'template_recommendation'
  | 'nx_session_management'

const execFileAsync = promisify(execFile)

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(MODULE_DIR, '../../..')

const TOOL_NAMES = [
  'mc_design_query_tasks',
  'mc_design_plan_workflow',
  'mc_design_classify_requirement',
  'mc_design_find_templates',
  'mc_design_recommend_templates',
  'mc_design_prepare_template_workspace',
  'mc_design_lookup_knowledge',
  'mc_design_estimate_parameters',
  'mc_design_filter_nx_expressions',
  'mc_design_list_local_assets',
  'mc_design_find_nx',
  'mc_design_prepare_nx_plugin',
  'mc_design_open_nx',
  'mc_design_close_nx',
  'mc_design_nx_health',
  'mc_design_nx_call_tool',
  'mc_design_run_local_chain_check',
  'mc_design_generate_nx_artifact',
  'mc_design_generate_report_artifacts',
  'mc_design_generate_dfmea_artifact',
  'mc_design_generate_conrod_drawing',
  'mc_design_tc_writeback_mock',
] as const

const COMPONENT_ALIASES: Record<string, McDesignComponent> = {
  conrod: 'conrod',
  connectingrod: 'conrod',
  connecting_rod: 'conrod',
  rod: 'conrod',
  连杆: 'conrod',
  crank: 'crankshaft',
  crankshaft: 'crankshaft',
  曲轴: 'crankshaft',
  cam: 'camshaft',
  camshaft: 'camshaft',
  凸轮轴: 'camshaft',
}

const REQUIRED_INPUTS: Record<McDesignComponent, string[]> = {
  conrod: [
    'body_height_mm',
    'head_gasket_thickness_mm',
    'compression_clearance_mm',
    'piston_compression_height_mm',
    'rod_journal_diameter_mm',
    'piston_pin_diameter_mm',
    'rod_bearing_thickness_mm',
    'crank_radius_mm',
    'stroke_mm',
    'bore_mm',
    'small_end_bushing_thickness_mm',
  ],
  crankshaft: ['bore_mm', 'stroke_mm', 'cylinder_count'],
  camshaft: [
    'cam_lift_mm',
    'base_circle_diameter_mm',
    'valve_duration_deg',
    'valve_count',
    'shaft_journal_diameter_mm',
    'cam_lobe_width_mm',
  ],
}

export function getMcDesignLocalToolDefinitions(): ToolDefinition[] {
  return TOOL_NAMES.map(name => ({
    name,
    description: descriptionFor(name),
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        task_id: { type: 'string' },
        component: { type: 'string', enum: ['conrod', 'crankshaft', 'camshaft'] },
        template_id: { type: 'string' },
        request_text: { type: 'string' },
        parameters: { type: 'object' },
        allow_confirmed_missing_images: { type: 'boolean' },
        include_dfmea: { type: 'boolean' },
        template_path: { type: 'string' },
        dfmea_template_path: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
    },
    annotations: {
      readOnlyHint: isReadOnlyTool(name),
      destructiveHint: false,
      openWorldHint: false,
    },
    searchHint: `mc design local ${name}`,
    alwaysLoad: true,
    execute: async (args, extra) => executeLocalTool(name, args, extra),
  }))
}

export function queryLocalTasks(args: JsonObject): JsonObject {
  const component = normalizeComponent(args.component)
  const taskId = stringValue(args.task_id) || stringValue(args.taskId)
  const query = normalizedText(args.query || args.request_text || args.text)
  const source = normalizedText(args.source)
  const limit = positiveInteger(args.limit) ?? 20

  const tasks = MC_DESIGN_TASKS
    .filter(task => !taskId || task.id === taskId)
    .filter(task => !component || task.component === component)
    .filter(task => !source || normalizedText(task.source).includes(source))
    .filter(task => {
      if (!query) return true
      const haystack = normalizedText([
        task.id,
        task.source,
        task.title,
        task.projectCode,
        task.projectName,
        task.component,
        task.owner,
        task.status,
        task.requirementText,
        JSON.stringify(task.explicitParameters ?? {}),
        JSON.stringify(task.performanceParameters ?? {}),
      ].join(' '))
      return haystack.includes(query)
    })
    .slice(0, limit)

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    count: tasks.length,
    tasks,
  }
}

export function classifyRequirement(args: JsonObject): JsonObject {
  const task = getMcDesignTask(stringValue(args.task_id) || stringValue(args.taskId))
  const text = stringValue(args.request_text) || stringValue(args.text) || task?.requirementText || ''
  const parameters = collectParameters(task, args, text)
  const component = normalizeComponent(args.component) || task?.component || inferComponent(text)
  const missingInputs = component
    ? REQUIRED_INPUTS[component].filter(key => parameters[key] === undefined)
    : []
  const intent = inferIntent(text, args, task, component, missingInputs)

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    intent,
    mode: intent,
    component,
    task_id: task?.id,
    extracted_parameters: parameters,
    missing_inputs: missingInputs,
    guided_input_options: guidedInputOptions(component, missingInputs),
    requires_confirmation: !component || missingInputs.length > 0 || !isReadOnlyIntent(intent),
    next_recommended_tool: nextToolForIntent(intent, component, missingInputs),
  }
}

export function findLocalTemplates(args: JsonObject): JsonObject {
  const task = getMcDesignTask(stringValue(args.task_id) || stringValue(args.taskId))
  const component = normalizeComponent(args.component) || task?.component
  const folderName = stringValue(args.folder_name)
  const keyword = normalizedText(args.keyword || args.query || args.request_text)

  const templates = MC_DESIGN_TEMPLATES.filter(template => {
    if (component && template.component !== component) return false
    if (folderName && template.folderName !== folderName) return false
    if (!keyword) return true
    return normalizedText([
      template.id,
      template.folderName,
      template.itemId,
      template.name,
      template.partFamily,
      template.datasetName,
      JSON.stringify(template.classificationAttributes ?? {}),
      JSON.stringify(template.nominalParameters ?? {}),
    ].join(' ')).includes(keyword)
  })

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    count: templates.length,
    templates,
    confirmation_required: true,
    instruction: 'Select one template_id and confirm before writing NX parameters, generating drawings, or creating release artifacts.',
  }
}

export function lookupLocalKnowledge(args: JsonObject): JsonObject {
  const component = normalizeComponent(args.component)
  const category = stringValue(args.category)
  const query = normalizedText(args.query || args.request_text)
  const limit = positiveInteger(args.limit) ?? 20

  const entries = MC_DESIGN_KNOWLEDGE.filter(entry => {
    if (component && entry.component !== component) return false
    if (category && entry.category !== category) return false
    if (!query) return true
    return normalizedText([
      entry.id,
      entry.category,
      entry.paramId,
      entry.standardName,
      entry.aliases.join(' '),
      entry.formula,
      entry.rule,
      entry.physicalMeaning,
      entry.source,
    ].filter(Boolean).join(' ')).includes(query)
  }).slice(0, limit)

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    count: entries.length,
    entries,
  }
}

export function recommendTemplates(args: JsonObject): JsonObject {
  const task = getMcDesignTask(stringValue(args.task_id) || stringValue(args.taskId))
  const text = stringValue(args.request_text) || stringValue(args.text) || task?.requirementText || ''
  const component = normalizeComponent(args.component) || task?.component || inferComponent(text)
  const parameters = collectParameters(task, args, text)
  const candidates = MC_DESIGN_TEMPLATES
    .filter(template => !component || template.component === component)
    .map(template => {
      const score = scoreTemplate(parameters, template)
      const implementation = templateImplementationStatus(template)
      return {
        template,
        implementation,
        ...score,
        score: Number(score.score ?? 0),
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, positiveInteger(args.limit) ?? 5)

  const topPick = candidates[0]

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    component,
    query_parameters: parameters,
    algorithm: 'weighted_normalized_euclidean_similarity_with_local_runnable_template_bias',
    recommendation_policy: '优先选择本地可打开的真实参数化模板；无完整输入时优先 baseline/master 模板，避免推荐偏离当前可运行范围的方案。',
    best_template_id: topPick?.template.id,
    recommendations: candidates,
    confirmation_required: true,
  }
}

export function estimateDesignParameters(args: JsonObject): JsonObject {
  const task = getMcDesignTask(stringValue(args.task_id) || stringValue(args.taskId))
  let template = getMcDesignTemplate(stringValue(args.template_id))
  const text = stringValue(args.request_text) || stringValue(args.text) || task?.requirementText || ''
  const component = normalizeComponent(args.component) || template?.component || task?.component || inferComponent(text)
  const supplied = collectParameters(task, args, text)
  const nominal = template?.nominalParameters ?? {}
  const parameters = {
    ...nominal,
    ...supplied,
  }
  if (!template && component) {
    template = selectBestLocalTemplate(component, parameters)
  }
  const rawNxParameters = computeNxParameters(component, parameters)
  const fitted = fitParametersToTemplateEnvelope(component, rawNxParameters, template)
  const baselineFit = fitParametersToTemplateDriveBaseline(component, fitted.parameters, rawNxParameters, template)
  const nxParameters = baselineFit.parameters
  const missingInputs = component
    ? REQUIRED_INPUTS[component].filter(key => parameters[key] === undefined)
    : []
  const isIncomplete = component && missingInputs.length > 0
  const includeDiagnostics = args.include_diagnostics === true || args.debug === true

  const result: JsonObject = {
    ok: !isIncomplete,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    component,
    task_id: task?.id,
    template_id: template?.id,
    template_implementation: template ? templateImplementationStatus(template) : undefined,
    parameters,
    nx_parameters: isIncomplete ? {} : nxParameters,
    nx_parameter_candidates: isIncomplete
      ? {}
      : buildNxParameterCandidates(component, nxParameters, fitted.parameters, rawNxParameters),
    parameter_ranges: isIncomplete ? {} : publicParameterRanges(component, fitted.ranges),
    checks: isIncomplete ? [] : buildChecks(component, parameters, nxParameters),
    missing_inputs: missingInputs.map(key => ({ key })),
    requires_confirmation: true,
    instruction: isIncomplete
      ? '缺少必要输入参数。请通过 AskUserQuestion 工具补充缺失的参数后重试。'
      : 'Review the estimated parameters and pass confirmed: true before any NX write operation.',
  }
  if (includeDiagnostics) {
    result.raw_nx_parameters = isIncomplete ? {} : rawNxParameters
    result.range_fitted_nx_parameters = isIncomplete ? {} : fitted.parameters
    result.template_baseline_nx_parameters = isIncomplete ? {} : baselineFit.baseline
    result.parameter_fit_notes = isIncomplete ? [] : [...fitted.notes, ...baselineFit.notes]
  }
  return result
}

function planWorkflow(args: JsonObject): JsonObject {
  const classified = classifyRequirement(args)
  const intent = classified.intent as WorkflowIntent
  const component = classified.component as McDesignComponent | undefined
  const missingInputs = Array.isArray(classified.missing_inputs)
    ? classified.missing_inputs as string[]
    : []
  const text = stringValue(args.request_text) || stringValue(args.text) || ''
  const normalized = normalizedText(text)

  const requiresGuidance =
    intent === 'guided_design' ||
    intent === 'optimization' ||
    intent === 'template_recommendation' ||
    intent === 'nx_session_management' ||
    (intent === 'performance_design' && missingInputs.length > 0) ||
    (intent === 'parameter_modeling' && missingInputs.length > 0) ||
    (intent === 'drawing_template_update' && component === 'conrod')
  const sideEffectsAllowed = false

  const recommendedTools = recommendedToolsForIntent(intent, component, missingInputs)
  const nextTool = nextToolForIntent(intent, component, missingInputs)

  const pluginToolHints: string[] = []
  if (intent === 'optimization') {
    pluginToolHints.push('nx_get_optimization_tool_guide', 'nx_validate_optimization_study')
  }

  const blockers: string[] = []
  if (intent === 'drawing_template_update' && component !== 'conrod') {
    blockers.push('drawing_template_only_conrod_supported')
  }

  const guardrails: string[] = []
  if (containsAny(normalized, ['nx', '开', 'ugraf']) || intent === 'nx_session_management') {
    guardrails.push('reuse_running_nx_before_launch')
  }

  const shouldQueryTasks = intent === 'task_execution' || intent === 'retrieval_comparison' || intent === 'report_generation' || intent === 'dfmea_generation'

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    intent,
    component,
    task_id: classified.task_id,
    missing_inputs: missingInputs,
    guided_input_options: guidedInputOptions(component, missingInputs),
    requires_guidance: requiresGuidance,
    side_effects_allowed: sideEffectsAllowed,
    should_query_tasks: shouldQueryTasks,
    should_estimate: intent === 'parameter_modeling' || intent === 'performance_design',
    should_recommend: intent === 'template_recommendation' || intent === 'parameter_modeling',
    recommended_tools: recommendedTools,
    recommended_next_tools: recommendedTools,
    next_recommended_tool: nextTool,
    plugin_tool_hints: pluginToolHints,
    blockers,
    guardrails,
    side_effects: intent === 'guided_design' || intent === 'retrieval_comparison' || intent === 'template_recommendation'
      ? []
      : ['requires explicit confirmation before writing files, launching NX, or generating artifacts'],
  }
}

async function prepareTemplateWorkspace(args: JsonObject, extra: ToolCallExtra): Promise<JsonObject> {
  if (args.confirmed !== true) {
    return {
      ok: false,
      error: 'confirmation_required',
      message: 'Copying a template workspace requires confirmed: true.',
    }
  }
  const template = getMcDesignTemplate(stringValue(args.template_id))
  if (!template) {
    return { ok: false, error: 'template_not_found', template_id: stringValue(args.template_id) }
  }
  const artifactRoot = await ensureArtifactDir(extra)
  const workspaceName = safeSegment(
    stringValue(args.workspace_name) || `${template.id}-${timestampSegment()}`,
  )
  const workspaceFolder = join(artifactRoot, 'workspaces', workspaceName)
  await mkdir(workspaceFolder, { recursive: true })

  const sourceFolder = template.localFolderPath
    ? resolve(PROJECT_ROOT, template.localFolderPath)
    : undefined
  let copied = false
  if (sourceFolder) {
    try {
      const sourceStat = await stat(sourceFolder)
      if (sourceStat.isDirectory()) {
        await cp(sourceFolder, workspaceFolder, { recursive: true, force: true })
        copied = true
      }
    } catch {
      copied = false
    }
  }

  const manifestPath = join(workspaceFolder, 'workspace-manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    ok: true,
    created_at: new Date().toISOString(),
    data_source: MC_DESIGN_LOCAL_SOURCE,
    template_id: template.id,
    source_folder: sourceFolder,
    source_copied: copied,
    template,
  }, null, 2), 'utf8')

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    template_id: template.id,
    source_folder: sourceFolder,
    workspace_folder: workspaceFolder,
    manifest_path: manifestPath,
    source_copied: copied,
    copied_whole_folder: copied,
    working_part_path: template.localPartPath
      ? join(workspaceFolder, basename(template.localPartPath))
      : undefined,
    working_drawing_template_path: template.localDrawingTemplatePath
      ? join(workspaceFolder, basename(template.localDrawingTemplatePath))
      : undefined,
  }
}

async function listLocalAssetsTool(args: JsonObject): Promise<JsonObject> {
  const includeDependencies = args.include_dependencies !== false
  const runtimeRoot = resolve(PROJECT_ROOT, MC_DESIGN_RUNTIME_ROOT)
  const assets: JsonObject[] = []
  await collectAssetEntries(runtimeRoot, runtimeRoot, assets, includeDependencies ? 300 : 80)
  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    runtime_root: runtimeRoot,
    count: assets.length,
    assets,
    fallback_data_loaded: MC_DESIGN_TASKS.length > 0 && MC_DESIGN_TEMPLATES.length > 0,
  }
}

async function generateNxArtifact(args: JsonObject, extra: ToolCallExtra): Promise<JsonObject> {
  if (args.confirmed !== true) {
    return { ok: false, error: 'confirmation_required', message: 'Generating artifacts requires confirmed: true.' }
  }
  const template = getMcDesignTemplate(stringValue(args.template_id))
  const component = normalizeComponent(args.component) || template?.component || 'conrod'
  if (component === 'camshaft') {
    return { ok: false, error: 'template_parameterization_only', message: 'Camshaft design is supported only through template parameterization, not create-new modeling.' }
  }
  const artifactDir = await ensureArtifactDir(extra)
  const artifactPath = join(artifactDir, `nx-mock-${component}-${timestampSegment()}.json`)
  const payload = {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    artifact_type: 'nx_mock',
    mock_only: true,
    component,
    template_id: template?.id,
    parameters: jsonObjectValue(args.parameters) ?? {},
    note: 'Mock NX artifact generated for local demonstration only. It does not modify real NX.',
  }
  await writeFile(artifactPath, JSON.stringify(payload, null, 2), 'utf8')
  return { ...payload, artifact_path: artifactPath }
}

async function generateReportArtifacts(args: JsonObject, extra: ToolCallExtra): Promise<JsonObject> {
  if (args.confirmed !== true) {
    return { ok: false, error: 'confirmation_required', message: 'Report generation requires confirmed: true.' }
  }
  const task = getMcDesignTask(stringValue(args.task_id) || stringValue(args.taskId))
  const template = getMcDesignTemplate(stringValue(args.template_id))
  const component = normalizeComponent(args.component) || template?.component || task?.component || 'conrod'
  const artifactDir = await ensureArtifactDir(extra)
  const requestParameters = jsonObjectValue(args.parameters) ?? {}
  const allowConfirmedMissing = allowsConfirmedMissingImages(args)
  const reportImagePaths = await findReportImagePaths(artifactDir, args)
  const parameters = {
    ...(task?.explicitParameters ?? {}),
    ...(template?.nominalParameters ?? {}),
    ...stripReportControlParameters(requestParameters),
  } as Record<string, number | string>

  if (!allowConfirmedMissing && reportImagePaths.length === 0) {
    return {
      ok: false,
      error: 'report_image_evidence_required',
      message: 'Design report generation requires image slots (NX screenshots, drawing exports). Provide an image path or set allow_confirmed_missing_images: true to proceed without images.',
    }
  }

  const pyResult = await tryDocxGeneration(
    artifactDir,
    component,
    parameters,
    task,
    template,
    reportImagePaths,
    allowConfirmedMissing,
  )
  const dfmeaResult = args.include_dfmea === true
    ? await generateDfmeaArtifact({ ...args, confirmed: true }, extra)
    : undefined
  const dfmeaFields = dfmeaResult?.ok
    ? {
      dfmea_path: dfmeaResult.dfmea_path,
      dfmea_format: dfmeaResult.dfmea_format,
      dfmea_rows: dfmeaResult.rows_count,
    }
    : {}
  if (pyResult) return { ...pyResult, ...dfmeaFields, data_source: MC_DESIGN_LOCAL_SOURCE }

  const reportPath = join(artifactDir, `design-report-${component}-${timestampSegment()}.md`)
  const content = [
    `# ${component} Local Design Report`,
    '',
    `- Task: ${task?.id ?? 'not bound'}`,
    `- Template: ${template?.id ?? 'not selected'}`,
    `- Created at: ${new Date().toISOString()}`,
    '',
    '## Parameters',
    '',
    ...Object.entries(parameters).map(([key, value]) => `- ${key}: ${String(value)}`),
    '',
    'This fallback report is generated locally to keep the server runnable when the optional DOCX runtime assets are not installed.',
  ].join('\n')
  await writeFile(reportPath, content, 'utf8')
  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    artifact_type: 'design_report_fallback',
    report_format: 'markdown',
    component,
    task_id: task?.id,
    template_id: template?.id,
    report_path: reportPath,
    ...dfmeaFields,
  }
}

function buildNxParameterCandidates(
  component: McDesignComponent | undefined,
  primaryParameters: Record<string, number>,
  fittedParameters: Record<string, number>,
  rawParameters: Record<string, number>,
): Record<string, number[]> {
  const result: Record<string, number[]> = {}
  const keys = new Set([
    ...Object.keys(primaryParameters),
    ...Object.keys(fittedParameters),
    ...Object.keys(rawParameters),
  ])

  for (const key of keys) {
    const values = [
      primaryParameters[key],
      fittedParameters[key],
      rawParameters[key],
    ].filter((value): value is number => Number.isFinite(value))

    const unique: number[] = []
    for (const value of values) {
      const rounded = publicNxParameterValue(component, value)
      if (!unique.includes(rounded)) unique.push(rounded)
    }
    result[key] = unique
  }

  return result
}

function publicParameterRanges(
  component: McDesignComponent | undefined,
  ranges: Record<string, JsonObject>,
): Record<string, JsonObject> {
  if (component !== 'crankshaft') return ranges
  return Object.fromEntries(
    Object.entries(ranges).map(([key, range]) => [key, {
      ...range,
      min: publicNxParameterValue(component, range.min),
      max: publicNxParameterValue(component, range.max),
    }]),
  )
}

function publicNxParameterValue(component: McDesignComponent | undefined, value: unknown): number {
  const parsed = numeric(value)
  if (parsed === undefined) return 0
  return component === 'crankshaft' || component === 'camshaft'
    ? Math.round(parsed)
    : roundEngineeringValue(parsed)
}

const DFMEA_TEMPLATE_FILE_NAMES = [
  '14N连杆部件边界图、P图和DFMEA.xls',
  'K09LN-1004201-01A-DFMEA01.xls',
  'K11-1004201-21-DFMEA01.xls',
]

const DFMEA_TEMPLATE_DIRS = [
  'F:\\Desktop\\defema',
  'F:\\Desktop\\dfmea',
]

async function generateDfmeaArtifact(args: JsonObject, extra: ToolCallExtra): Promise<JsonObject> {
  if (args.confirmed !== true) {
    return { ok: false, error: 'confirmation_required', message: 'DFMEA generation requires confirmed: true.' }
  }

  const task = getMcDesignTask(stringValue(args.task_id) || stringValue(args.taskId))
  const template = getMcDesignTemplate(stringValue(args.template_id))
  const component = normalizeComponent(args.component) || template?.component || task?.component || inferComponent(stringValue(args.request_text) ?? '') || 'conrod'
  if (component !== 'conrod') {
    return {
      ok: false,
      error: 'dfmea_component_not_supported',
      component,
      message: '当前本地 DFMEA 生成仅稳定支持连杆模板；曲轴和凸轮轴需补充对应 DFMEA 模板后再启用。',
    }
  }

  const artifactDir = await ensureArtifactDir(extra)
  const sourcePath = await findDfmeaTemplatePath(args)
  if (!sourcePath) {
    return {
      ok: false,
      error: 'dfmea_template_not_found',
      component,
      message: '未找到可复制的连杆 DFMEA .xls 模板。请提供 dfmea_template_path 或确认 F:\\Desktop\\defema 下的模板存在。',
      candidate_paths: dfmeaTemplateCandidates(args),
    }
  }

  const sourceInfo = await stat(sourcePath)
  const dfmeaPath = join(artifactDir, `dfmea-conrod-${timestampSegment()}-${basename(sourcePath)}`)
  await copyFile(sourcePath, dfmeaPath)

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    artifact_type: 'dfmea_template_copy',
    dfmea_format: 'xls',
    component,
    task_id: task?.id,
    template_id: template?.id,
    dfmea_path: dfmeaPath,
    source_template_path: sourcePath,
    template_source_path: sourcePath,
    copied_template: true,
    content_modified: false,
    source_size_bytes: sourceInfo.size,
    reference_templates: DFMEA_TEMPLATE_FILE_NAMES,
  }
}

function dfmeaTemplateCandidates(args: JsonObject): string[] {
  const parameters = jsonObjectValue(args.parameters) ?? {}
  const explicit = [
    stringValue(args.dfmea_template_path),
    stringValue(args.dfmeaTemplatePath),
    stringValue(args.template_path),
    stringValue(args.templatePath),
    stringValue(parameters.dfmea_template_path),
    stringValue(parameters.dfmeaTemplatePath),
    stringValue(parameters.template_path),
    stringValue(parameters.templatePath),
    stringValue(process.env.MC_DESIGN_DFMEA_TEMPLATE_PATH),
  ].filter((value): value is string => Boolean(value))
  const dirs = [
    stringValue(args.dfmea_template_dir),
    stringValue(args.dfmeaTemplateDir),
    stringValue(parameters.dfmea_template_dir),
    stringValue(parameters.dfmeaTemplateDir),
    stringValue(process.env.MC_DESIGN_DFMEA_TEMPLATE_DIR),
    ...DFMEA_TEMPLATE_DIRS,
  ].filter((value): value is string => Boolean(value))
  return [
    ...explicit,
    ...dirs.flatMap(dir => DFMEA_TEMPLATE_FILE_NAMES.map(fileName => join(dir, fileName))),
  ].map(candidate => resolve(candidate))
}

async function findDfmeaTemplatePath(args: JsonObject): Promise<string | undefined> {
  for (const candidate of dfmeaTemplateCandidates(args)) {
    try {
      const info = await stat(candidate)
      if (info.isFile() && candidate.toLowerCase().endsWith('.xls')) return candidate
    } catch {
      // Try the next configured template path.
    }
  }
  return undefined
}

function allowsConfirmedMissingImages(args: JsonObject): boolean {
  const parameters = jsonObjectValue(args.parameters) ?? {}
  return truthyFlag(args.allow_confirmed_missing_images)
    || truthyFlag(args.allowConfirmedMissingImages)
    || truthyFlag(parameters.allow_confirmed_missing_images)
    || truthyFlag(parameters.allowConfirmedMissingImages)
    || normalizedText(args.request_text).includes('allow_confirmed_missing_images=true')
}

function stripReportControlParameters(parameters: JsonObject): JsonObject {
  const result: JsonObject = {}
  for (const [key, value] of Object.entries(parameters)) {
    if ([
      'allow_confirmed_missing_images',
      'allowConfirmedMissingImages',
      'include_dfmea',
      'includeDfmea',
      'image_path',
      'imagePath',
      'screenshot_path',
      'screenshotPath',
      'report_image_path',
      'reportImagePath',
    ].includes(key)) continue
    result[key] = value
  }
  return result
}

async function findReportImagePaths(artifactDir: string, args: JsonObject): Promise<string[]> {
  const parameters = jsonObjectValue(args.parameters) ?? {}
  const explicit = [
    stringValue(args.image_path),
    stringValue(args.imagePath),
    stringValue(args.screenshot_path),
    stringValue(args.screenshotPath),
    stringValue(args.report_image_path),
    stringValue(args.reportImagePath),
    stringValue(parameters.image_path),
    stringValue(parameters.imagePath),
    stringValue(parameters.screenshot_path),
    stringValue(parameters.screenshotPath),
    stringValue(parameters.report_image_path),
    stringValue(parameters.reportImagePath),
    ...(stringArray(args.image_paths) ?? []),
    ...(stringArray(args.imagePaths) ?? []),
    ...(stringArray(parameters.image_paths) ?? []),
    ...(stringArray(parameters.imagePaths) ?? []),
  ].filter((value): value is string => Boolean(value))

  let artifactImages: string[] = []
  try {
    const entries = await readdir(artifactDir)
    artifactImages = entries
      .filter(entry => isReportImageFile(entry))
      .map(entry => join(artifactDir, entry))
  } catch {
    artifactImages = []
  }

  const result: string[] = []
  for (const candidate of [...explicit, ...artifactImages]) {
    const resolved = resolve(candidate)
    try {
      const info = await stat(resolved)
      if (info.isFile() && isReportImageFile(resolved) && !result.includes(resolved)) {
        result.push(resolved)
      }
    } catch {
      // Ignore stale paths.
    }
  }
  return result
}

function isReportImageFile(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.bmp')
}

function truthyFlag(value: unknown): boolean {
  if (value === true) return true
  if (typeof value !== 'string') return false
  return ['true', '1', 'yes', 'y', '是', '确认', '已确认'].includes(normalizedText(value))
}

async function tryDocxGeneration(
  artifactDir: string,
  component: string,
  parameters: Record<string, number | string>,
  task: McDesignTask | undefined,
  template: McDesignTemplate | undefined,
  reportImagePaths: string[],
  allowConfirmedMissingImages: boolean,
): Promise<JsonObject | undefined> {
  const pyExe = join(PROJECT_ROOT, 'runtime', 'mc-design', 'dependencies', 'python', 'python.exe')
  const pyScript = join(PROJECT_ROOT, 'runtime', 'mc-design', 'dependencies', 'skills', 'design-report', 'scripts', 'design_report.py')
  const docxTemplate = join(PROJECT_ROOT, 'runtime', 'mc-design', 'dependencies', 'skills', 'design-report', 'templates', 'conrod_design_report_template.docx')

  try {
    await stat(pyExe)
    await stat(pyScript)
    await stat(docxTemplate)
  } catch {
    return undefined
  }

  const workspace = artifactDir
  const reportFileName = `design_report_${timestampSegment()}.docx`
  const outputPath = join(workspace, reportFileName)
  await mkdir(workspace, { recursive: true })

  try {
    const pyEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      MC_DESIGN_REPORT_TEMPLATE: docxTemplate,
    }
    const inspectResult = await execFileAsync(pyExe, [
      pyScript, 'inspect-template',
      '--template', docxTemplate,
    ], { timeout: 15_000, env: pyEnv })
    const templateInfo = JSON.parse(inspectResult.stdout.trim()) as {
      ok: boolean; slot_count: number
      slots: Array<{ type: string; name: string; section: string }>
    }
    if (!templateInfo.ok || !Array.isArray(templateInfo.slots)) return undefined

    const slotValues: Record<string, unknown> = {}
    let imageIndex = 0
    for (const slot of templateInfo.slots) {
      const key = slot.name
      if (coreReportSlots[key]) {
        slotValues[key] = {
          value: String(coreReportSlots[key]),
          source: 'local_fixture',
          status: 'auto',
        }
      } else if (parameters[key] !== undefined) {
        slotValues[key] = {
          value: String(parameters[key]),
          source: 'calculated_parameters',
          status: 'auto',
        }
      } else if (slot.type === 'image') {
        const imagePath = reportImagePaths[imageIndex] ?? reportImagePaths[0]
        if (imagePath) {
          slotValues[key] = {
            image_path: imagePath,
            source: 'nx_create_image',
            status: 'filled',
          }
          imageIndex += 1
        } else if (allowConfirmedMissingImages) {
          slotValues[key] = {
            status: 'confirmed_missing',
            confirmation_source: 'user',
            reason: '未提供 NX 截图，用户确认在本地演示中暂缺',
          }
        }
      } else {
        slotValues[key] = {
          value: filledFromContext(slot, component, task, template),
          source: 'local_fixture',
          status: 'auto',
        }
      }
    }

    const payload = {
      output_path: outputPath,
      slots: slotValues,
      slot_values: slotValues,
    }
    const payloadPath = join(workspace, `report_payload_${timestampSegment()}.json`)
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8')

    const generateResult = await execFileAsync(pyExe, [
      pyScript, 'generate',
      '--workspace', workspace,
      '--input', payloadPath,
    ], { timeout: 60_000, env: pyEnv })
    const genResult = JSON.parse(generateResult.stdout.trim()) as { ok: boolean; remaining_raw_slot_count?: number }

    return {
      ok: true,
      artifact_type: 'design_report_docx',
      report_format: 'docx',
      report_path: outputPath,
      component,
      task_id: task?.id,
      template_id: template?.id,
      template_path: docxTemplate,
      generator_script: pyScript,
      generation_result: genResult,
    }
  } catch {
    return undefined
  }
}

const coreReportSlots: Record<string, string> = {
  '设计员': 'local-engineer',
  '当前日期': new Date().toISOString().split('T')[0],
  '当前时间': new Date().toISOString().split('T')[1]?.split('.')[0] ?? '',
  '版本号': 'A',
  '更改原因': '本地演示验证',
  '设计原型图号': 'N/A',
  '新图号/版本号': 'B',
  '方案说明': '基于本地知识库和经验公式的参数化设计方案。',
}

function filledFromContext(
  slot: { type: string; name: string; section: string },
  component: string,
  task: McDesignTask | undefined,
  template: McDesignTemplate | undefined,
): string {
  const name = slot.name.toLowerCase()
  if (name.includes('编号') || name.includes('图号') || name.includes('文件')) {
    return template?.itemId ?? task?.id ?? 'N/A'
  }
  if (name.includes('名称') || name.includes('标题')) {
    return template?.name ?? task?.title ?? `${component} design report`
  }
  if (name.includes('目的')) {
    return task?.requirementText ?? '参数化零部件设计'
  }
  if (name.includes('原型')) {
    return task?.id ?? 'N/A'
  }
  if (name.includes('整机')) {
    return 'N/A'
  }
  if (name.includes('审核')) {
    return 'local-reviewer'
  }
  if (name.includes('批准')) {
    return 'local-approver'
  }
  return '本地验证数据'
}

async function generateConrodDrawing(args: JsonObject, extra: ToolCallExtra): Promise<JsonObject> {
  if (args.confirmed !== true) {
    return { ok: false, error: 'confirmation_required', message: 'Drawing update requires confirmed: true.' }
  }
  const template = getMcDesignTemplate(stringValue(args.template_id) || 'TC-TPL-CONROD-A')
  if (!template || template.component !== 'conrod') {
    return { ok: false, error: 'conrod_template_required', template_id: stringValue(args.template_id) }
  }
  const artifactDir = await ensureArtifactDir(extra)
  const baseUrl = stringValue(args.base_url) ?? stringValue(args.baseUrl)
  const nxPort = positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port)
  const nxOpts = { baseUrl, port: nxPort }

  if (baseUrl) {
    const calledTools: string[] = []
    try {
      const partPath = template.localPartPath || template.localDrawingTemplatePath
      if (partPath) {
        const resolvedPartPath = resolve(PROJECT_ROOT, partPath)
        const openResult = await callNxPluginTool('nx_open_part', { path: resolvedPartPath }, nxOpts)
        calledTools.push('OpenPart')
        if (!openResult.ok) {
          const infoResult = await callNxPluginTool('nx_get_work_part_info', {}, nxOpts)
          calledTools.push('GetWorkPartInfo')
        }
      }
      const sheetList = await callNxPluginTool('nx_get_drawing_sheet_name_list', {}, nxOpts)
      calledTools.push('GetDrawingSheetNameList')
      const sheetData = (sheetList.result as Record<string, unknown>)?.data as unknown[]
      if (Array.isArray(sheetData) && sheetData.length > 0) {
        await callNxPluginTool('nx_open_drawing_sheet', { drawSheetName: String(sheetData[0]) }, nxOpts)
        calledTools.push('OpenDrawingSheet')
      }
      await callNxPluginTool('nx_update_drawings', {}, nxOpts)
      calledTools.push('Updatedrawings')
      const imagePath = join(artifactDir, `conrod-drawing-${timestampSegment()}.png`)
      await callNxPluginTool('nx_create_image', { filePath: imagePath }, nxOpts)
      calledTools.push('CreateImage')
      return {
        ok: true,
        data_source: MC_DESIGN_LOCAL_SOURCE,
        artifact_type: 'conrod_drawing_nx',
        template_id: template.id,
        print_receipt_path: imagePath,
        called_tools: calledTools,
        blockers: [],
      }
    } catch (err) {
      // Fall back to stub receipt on NX error
    }
  }

  const receiptPath = join(artifactDir, `conrod-drawing-${timestampSegment()}.json`)
  const payload = {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    artifact_type: 'conrod_drawing_template_update_fallback',
    template_id: template.id,
    drawing_automation_disabled: true,
    note: 'Real NX drawing automation was not executed. This receipt keeps the local server/tool runtime stable.',
  }
  await writeFile(receiptPath, JSON.stringify(payload, null, 2), 'utf8')
  return { ...payload, receipt_path: receiptPath }
}

function filterNxExpressionsTool(args: JsonObject): JsonObject {
  const expressionsInput = args.expressions ?? args.nx_expressions
  if (Array.isArray(expressionsInput)) {
    const kept: JsonObject[] = []
    const filteredOut: JsonObject[] = []
    const notes: JsonObject[] = []
    for (const item of expressionsInput) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const expr = item as JsonObject
        const stdId = String(expr.std_id ?? '')
        const equation = String(expr.equation ?? '')
        const isAnonymous = /^p\d+$/i.test(stdId)
        if (!isAnonymous) {
          kept.push(expr)
        } else if (extractStandardIds(equation).length > 0) {
          const relatedStandardParams = extractStandardIds(equation)
          kept.push({ ...expr, uncertainty: 'anonymous_expression_related_to_standard_parameters', relatedStandardParams })
          notes.push({ std_id: expr.std_id, equation: expr.equation, uncertainty: `Anonymous expression is retained because it references ${relatedStandardParams.join(', ')}.` })
        } else {
          filteredOut.push({ ...expr, filterReason: 'isolated_anonymous_expression' })
        }
      }
    }
    return {
      ok: true,
      data_source: MC_DESIGN_LOCAL_SOURCE,
      expressions: kept,
      filtered_out: filteredOut,
      notes,
    }
  }
  const parameters = jsonObjectValue(args.parameters) ?? jsonObjectValue(args.nx_parameters) ?? {}
  const filtered = Object.fromEntries(
    Object.entries(parameters).filter(([key]) => !/^p\d+$/i.test(key)),
  )
  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    filtered_parameters: filtered,
    removed_anonymous_parameters: Object.keys(parameters).filter(key => /^p\d+$/i.test(key)),
  }
}

function extractStandardIds(value: string): string[] {
  const matches = value.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g) ?? []
  return [...new Set(matches)]
}

function safeNxUnavailable(tool: string, args: JsonObject = {}): JsonObject {
  return {
    ok: false,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    tool,
    error: 'nx_runtime_not_configured',
    message: '当前环境没有检测到 Siemens NX 安装，因此无法实际驱动 NX 建模。如需真实 NX 建模，需要在本机安装并配置 NX plugin。',
    input: args,
  }
}

async function findNxTool(args: JsonObject): Promise<JsonObject> {
  const installations = await discoverNxInstallations({
    extraRoots: stringArray(args.extra_roots),
    referenceRoot: stringValue(args.reference_root) ?? stringValue(args.referenceRoot),
    baseUrl: stringValue(args.base_url) ?? stringValue(args.baseUrl),
    port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
  })
  const running = await listNxProcesses()
  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    installations,
    installations_count: installations.length,
    running_processes: running,
    running_count: running.length,
    project_plugin_dir: 'runtime/mc-design/dependencies/nx-plugin',
    instruction: installations.length > 0
      ? '检测到可用 NX 安装。可调用 mc_design_open_nx 启动或复用 NX。'
      : '未检测到本地 NX 安装。将在模拟模式下运行。',
  }
}

async function prepareNxPluginTool(args: JsonObject): Promise<JsonObject> {
  const write = args.write === true
  const confirmed = args.confirmed === true
  if (write && !confirmed) {
    return {
      ok: false,
      error: 'confirmation_required',
      message: '注册 NX plugin 需要 confirmed: true 和 write: true。请确认后再执行。',
    }
  }
  const result = await prepareProjectNxPlugin({
    executablePath: stringValue(args.executable_path) ?? stringValue(args.executablePath),
    pluginDir: stringValue(args.plugin_dir) ?? stringValue(args.pluginDir),
    baseUrl: stringValue(args.base_url) ?? stringValue(args.baseUrl),
    port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
    write,
    confirmed,
  })
  return { ...result, data_source: MC_DESIGN_LOCAL_SOURCE }
}

async function openNxTool(args: JsonObject, extra: ToolCallExtra): Promise<JsonObject> {
  const partPath = resolveOpenNxPartPath(args)
  const baseUrl = stringValue(args.base_url) ?? stringValue(args.baseUrl)
  const port = positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port)
  const result = await openNx({
    executablePath: stringValue(args.executable_path) ?? stringValue(args.executablePath),
    partPath,
    waitSeconds: positiveInteger(args.wait_seconds) ?? positiveInteger(args.waitSeconds) ?? 20,
    sessionId: extra.sessionId || extra.taskId,
    reuseRunning: args.reuse_running !== false && args.reuseRunning !== false,
    baseUrl,
    port,
  })

  if (result.ok && result.alreadyRunning && result.partOpenRequired && partPath) {
    const resolvedPath = resolve(PROJECT_ROOT, partPath)
    const openResult = await callNxPluginTool('nx_open_part', { path: resolvedPath }, { baseUrl, port })
    return {
      ...result,
      data_source: MC_DESIGN_LOCAL_SOURCE,
      part_opened_via_plugin: openResult.ok,
      part_open_result: openResult,
    }
  }

  if (result.ok && !result.alreadyRunning && partPath) {
    const resolvedPath = resolve(PROJECT_ROOT, partPath)
    const health = await getNxPluginStatus({ baseUrl, port })
    if (health.ok) {
      const openResult = await callNxPluginTool('nx_open_part', { path: resolvedPath }, { baseUrl, port })
      return {
        ...result,
        data_source: MC_DESIGN_LOCAL_SOURCE,
        part_opened_via_plugin: openResult.ok,
        part_open_result: openResult,
      }
    }
  }

  return { ...result, data_source: MC_DESIGN_LOCAL_SOURCE }
}

function resolveOpenNxPartPath(args: JsonObject): string | undefined {
  const parameters = jsonObjectValue(args.parameters) ?? jsonObjectValue(args.parameter)
  const workspace = jsonObjectValue(args.workspace) ?? jsonObjectValue(args.template_workspace)
  return stringValue(args.part_path)
    ?? stringValue(args.partPath)
    ?? stringValue(args.path)
    ?? stringValue(args.workspace_part_path)
    ?? stringValue(args.workspacePartPath)
    ?? stringValue(args.working_part_path)
    ?? stringValue(args.workingPartPath)
    ?? stringValue(parameters?.part_path)
    ?? stringValue(parameters?.partPath)
    ?? stringValue(parameters?.path)
    ?? stringValue(parameters?.workspace_part_path)
    ?? stringValue(parameters?.workspacePartPath)
    ?? stringValue(parameters?.working_part_path)
    ?? stringValue(parameters?.workingPartPath)
    ?? stringValue(workspace?.working_part_path)
    ?? stringValue(workspace?.workingPartPath)
}

async function closeNxTool(args: JsonObject, extra: ToolCallExtra): Promise<JsonObject> {
  const result = await closeNx({
    sessionId: extra.sessionId || extra.taskId,
    pids: numberArray(args.pids),
    onlyStartedByTool: args.only_started_by_tool !== false && args.onlyStartedByTool !== false,
    force: args.force === true,
  })
  return { ...result, data_source: MC_DESIGN_LOCAL_SOURCE }
}

async function nxHealthTool(args: JsonObject): Promise<JsonObject> {
  const status = await getNxPluginStatus({
    baseUrl: stringValue(args.base_url) ?? stringValue(args.baseUrl),
    port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
  })
  return { ...status, data_source: MC_DESIGN_LOCAL_SOURCE }
}

async function nxCallTool(args: JsonObject): Promise<JsonObject> {
  const toolName = stringValue(args.tool) || stringValue(args.tool_name) || ''
  if (!toolName) {
    return {
      ok: false,
      error: 'missing_tool_name',
      message: '需要提供 tool 或 tool_name 参数指定要调用的 NX 插件工具名。',
    }
  }
  const resolved = resolveNxToolName(toolName)
  const writeTool = isNxWriteTool(toolName)
  if (writeTool && args.confirmed !== true) {
    return {
      ok: false,
      error: 'confirmation_required',
      message: `NX 工具 "${resolved}" 具有写/修改副作用，需要 confirmed: true。`,
      tool: toolName,
      resolved,
      is_write: true,
    }
  }
  const result = await callNxPluginTool(
    toolName,
    jsonObjectValue(args.arguments) ?? jsonObjectValue(args.args) ?? {},
    {
      baseUrl: stringValue(args.base_url) ?? stringValue(args.baseUrl),
      port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
      requestTimeoutMs: positiveInteger(args.request_timeout_ms)
        ?? positiveInteger(args.requestTimeoutMs)
        ?? positiveInteger(args.timeout_ms)
        ?? positiveInteger(args.timeoutMs),
      writeTimeoutMs: positiveInteger(args.write_timeout_ms)
        ?? positiveInteger(args.writeTimeoutMs),
    },
  )
  return { ...result, data_source: MC_DESIGN_LOCAL_SOURCE, resolved }
}

async function runLocalChainCheck(args: JsonObject, extra: ToolCallExtra): Promise<JsonObject> {
  const classified = classifyRequirement(args)
  const recommendation = recommendTemplates(args)
  const templateId = stringValue(args.template_id) || stringValue((recommendation.recommendations as unknown[] | undefined)?.[0]?.['template']?.['id'])
  const estimate = estimateDesignParameters({ ...args, template_id: templateId })
  const requireNx = args.require_real_nx === true

  if (!requireNx) {
    const artifact = args.generate_artifact === true
      ? await generateNxArtifact({ ...args, template_id: templateId, confirmed: true }, extra)
      : undefined
    return {
      ok: true,
      data_source: MC_DESIGN_LOCAL_SOURCE,
      classified,
      recommendation,
      estimate,
      artifact,
    }
  }

  const blockers: string[] = []
  const calledTools: string[] = []

  const installations = await discoverNxInstallations({
    referenceRoot: stringValue(args.reference_root) ?? stringValue(args.referenceRoot),
    extraRoots: stringArray(args.extra_roots) ?? stringArray(args.extraRoots),
    baseUrl: stringValue(args.base_url) ?? stringValue(args.baseUrl),
    port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
  })
  const nxAvailable = installations.length > 0
  const nxInstalled = typeof stringValue(args.base_url) === 'string' || nxAvailable
  if (!nxInstalled) {
    blockers.push('NX 未检测到可用的 Siemens NX 安装。')
  }

  if (nxInstalled && args.confirmed !== true) {
    blockers.push('要求 real NX 运行时但未设置 confirmed: true。')
  }

  if (blockers.length > 0) {
    return {
      ok: blockers.length === 0,
      data_source: MC_DESIGN_LOCAL_SOURCE,
      blockers,
      classified,
      recommendation,
      estimate,
    }
  }

  const health = await getNxPluginStatus({
    baseUrl: stringValue(args.base_url) ?? stringValue(args.baseUrl),
    port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
  })
  if (!health.ok) {
    blockers.push(`NX plugin 健康检查失败: ${String(health.error ?? '未知错误')}`)
    return {
      ok: false,
      data_source: MC_DESIGN_LOCAL_SOURCE,
      blockers,
      classified,
      recommendation,
      estimate,
      health,
    }
  }

  const testResult = await callNxPluginTool('nx_test', {}, {
    baseUrl: stringValue(args.base_url),
    port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
  })
  calledTools.push('Test')

  const templateObj = getMcDesignTemplate(templateId)
  if (templateObj?.localPartPath) {
    const resolvedPartPath = resolve(PROJECT_ROOT, templateObj.localPartPath)
    await callNxPluginTool('nx_open_part', { path: resolvedPartPath }, {
      baseUrl: stringValue(args.base_url),
      port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
    })
    calledTools.push('OpenPart')
  }

  const partInfo = await callNxPluginTool('nx_get_work_part_info', {}, {
    baseUrl: stringValue(args.base_url),
    port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
  })
  calledTools.push('GetWorkPartInfo')

  const driveParams = await callNxPluginTool('nx_get_drive_params_list', {}, {
    baseUrl: stringValue(args.base_url),
    port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
  })
  calledTools.push('GetDriveParamsList')

  const nxParams = jsonObjectValue(args.parameters) ?? jsonObjectValue(estimate.nx_parameters) ?? {}
  const mappings = mapNxParametersToExpressions(nxParams, driveParams.result ?? driveParams)

  let writeResult: JsonObject | undefined
  if (args.write_mode === 'same_value' || args.confirmed === true) {
    const updates = sameValueBatchUpdates(mappings)
    if (updates.length > 0) {
      const batchResult = await callNxPluginTool('nx_batch_update_params', { expressions: updates }, {
        baseUrl: stringValue(args.base_url),
        port: positiveInteger(args.port) ?? positiveInteger(args.nx_plugin_port),
      })
      writeResult = batchResult
      calledTools.push('BatchUpdateParams')
    }
  }

  let reportResult: JsonObject | undefined
  if (args.generate_report === true) {
    reportResult = await generateReportArtifacts({
      ...args,
      template_id: templateId,
      confirmed: true,
      include_dfmea: args.include_dfmea !== false,
      allow_confirmed_missing_images: true,
    }, extra)
  }

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    blockers: [],
    classified,
    recommendation,
    estimate,
    nx_available: nxAvailable,
    health: health.ok,
    test: testResult.ok,
    part_info: partInfo.ok,
    mappings,
    write_result: writeResult,
    called_tools: calledTools,
    report_result: reportResult,
  }
}

async function executeLocalTool(
  name: typeof TOOL_NAMES[number],
  args: JsonObject,
  extra: ToolCallExtra,
): Promise<CallToolResult> {
  switch (name) {
    case 'mc_design_query_tasks':
      return jsonResult(queryLocalTasks(args))
    case 'mc_design_plan_workflow':
      return jsonResult(planWorkflow(args))
    case 'mc_design_classify_requirement':
      return jsonResult(classifyRequirement(args))
    case 'mc_design_find_templates':
      return jsonResult(findLocalTemplates(args))
    case 'mc_design_recommend_templates':
      return jsonResult(recommendTemplates(args))
    case 'mc_design_prepare_template_workspace':
      return jsonResult(await prepareTemplateWorkspace(args, extra), args.confirmed !== true)
    case 'mc_design_lookup_knowledge':
      return jsonResult(lookupLocalKnowledge(args))
    case 'mc_design_estimate_parameters':
      return jsonResult(estimateDesignParameters(args))
    case 'mc_design_filter_nx_expressions':
      return jsonResult(filterNxExpressionsTool(args))
    case 'mc_design_list_local_assets':
      return jsonResult(await listLocalAssetsTool(args))
    case 'mc_design_generate_nx_artifact':
      return jsonResult(await generateNxArtifact(args, extra), args.confirmed !== true)
    case 'mc_design_generate_report_artifacts': {
      const reportResult = await generateReportArtifacts(args, extra)
      return jsonResult(reportResult, !reportResult.ok)
    }
    case 'mc_design_generate_dfmea_artifact': {
      const dfmeaResult = await generateDfmeaArtifact(args, extra)
      return jsonResult(dfmeaResult, !dfmeaResult.ok)
    }
    case 'mc_design_generate_conrod_drawing':
      return jsonResult(await generateConrodDrawing(args, extra), args.confirmed !== true)
    case 'mc_design_run_local_chain_check':
      return jsonResult(await runLocalChainCheck(args, extra))
    case 'mc_design_tc_writeback_mock':
      return jsonResult({
        ok: true,
        data_source: MC_DESIGN_LOCAL_SOURCE,
        mock_only: true,
        writeback_status: 'recorded_locally',
        input: args,
      })
    case 'mc_design_find_nx':
      return jsonResult(await findNxTool(args))
    case 'mc_design_prepare_nx_plugin':
      return jsonResult(await prepareNxPluginTool(args), args.confirmed !== true || args.write !== true)
    case 'mc_design_open_nx':
      return jsonResult(await openNxTool(args, extra))
    case 'mc_design_close_nx':
      return jsonResult(await closeNxTool(args, extra))
    case 'mc_design_nx_health':
      return jsonResult(await nxHealthTool(args))
    case 'mc_design_nx_call_tool':
      return jsonResult(await nxCallTool(args), args.confirmed !== true)
    default:
      return jsonResult({ ok: false, error: 'unknown_tool', name }, true)
  }
}

function descriptionFor(name: string): string {
  switch (name) {
    case 'mc_design_query_tasks': return 'Query local mc-design task fixtures.'
    case 'mc_design_plan_workflow': return 'Plan a local component design workflow without side effects.'
    case 'mc_design_classify_requirement': return 'Classify a component design request and identify missing inputs.'
    case 'mc_design_find_templates': return 'Find local component design templates.'
    case 'mc_design_recommend_templates': return 'Recommend templates using local parameters and simple similarity scoring.'
    case 'mc_design_prepare_template_workspace': return 'Copy or create a local template workspace after explicit confirmation.'
    case 'mc_design_lookup_knowledge': return 'Search the local mc-design knowledge fixture.'
    case 'mc_design_estimate_parameters': return 'Estimate design parameters from task, template, text, and explicit inputs.'
    case 'mc_design_filter_nx_expressions': return 'Filter unsafe anonymous NX expression names from parameter input.'
    case 'mc_design_list_local_assets': return 'List runtime/mc-design local assets if they exist.'
    case 'mc_design_find_nx': return 'Report Siemens NX runtime status.'
    case 'mc_design_prepare_nx_plugin': return 'Prepare Siemens NX plugin registration when the optional runtime is configured.'
    case 'mc_design_open_nx': return 'Open or reuse Siemens NX when the optional runtime is configured.'
    case 'mc_design_close_nx': return 'Close Siemens NX when the optional runtime is configured.'
    case 'mc_design_nx_health': return 'Check Siemens NX plugin health when the optional runtime is configured.'
    case 'mc_design_nx_call_tool': return 'Call an NX plugin tool when the optional runtime is configured.'
    case 'mc_design_run_local_chain_check': return 'Run a safe local workflow smoke check.'
    case 'mc_design_generate_nx_artifact': return 'Generate a local mock NX artifact after confirmation.'
    case 'mc_design_generate_report_artifacts': return 'Generate a local DOCX design report after confirmation.'
    case 'mc_design_generate_dfmea_artifact': return 'Copy a local conrod DFMEA .xls template after confirmation without modifying content.'
    case 'mc_design_generate_conrod_drawing': return 'Generate a fallback conrod drawing update receipt after confirmation.'
    case 'mc_design_tc_writeback_mock': return 'Record a local Teamcenter writeback mock.'
    default: return `Local mc-design tool ${name}.`
  }
}

function isReadOnlyTool(name: string): boolean {
  return ![
    'mc_design_prepare_template_workspace',
    'mc_design_prepare_nx_plugin',
    'mc_design_open_nx',
    'mc_design_close_nx',
    'mc_design_nx_call_tool',
    'mc_design_generate_nx_artifact',
    'mc_design_generate_report_artifacts',
    'mc_design_generate_dfmea_artifact',
    'mc_design_generate_conrod_drawing',
    'mc_design_tc_writeback_mock',
  ].includes(name)
}

function inferIntent(
  text: string,
  args: JsonObject,
  task: McDesignTask | undefined,
  component: McDesignComponent | undefined,
  missingInputs: string[],
): WorkflowIntent {
  const normalized = normalizedText(text)
  const mode = stringValue(args.workflow_mode)
  if (mode && mode !== 'auto') return mode as WorkflowIntent
  if (containsAny(normalized, ['dfmea', 'defema', 'fmea', '失效模式', '失效分析', '风险复核'])) return 'dfmea_generation'
  if (containsAny(normalized, ['report', 'doc', 'docx', '报告', '说明书'])) return 'report_generation'
  if (containsAny(normalized, ['drawing', 'draw', 'print', '图纸', '出图', '打印'])) return 'drawing_template_update'
  if (containsAny(normalized, ['optimize', 'optimization', '优化'])) return 'optimization'
  if (containsAny(normalized, ['compare', 'comparison', '对比', '比较'])) return 'retrieval_comparison'
  if (containsAny(normalized, ['nx', 'open', 'close', 'reuse', 'ugraf', '开'])) return 'nx_session_management'
  if (containsAny(normalized, ['query', 'task', 'ipm', 'ecs', 'ecr', 'qpp', '任务', '查询']) || task) return 'task_execution'
  if (containsAny(normalized, ['参数化'])) return 'parameter_modeling'
  if (containsAny(normalized, ['template', 'recommend', '模板', '推荐'])) return 'template_recommendation'
  if (containsAny(normalized, ['performance', 'torque', 'efficiency', 'pressure', '性能', '扭矩', '压力'])) return 'performance_design'
  if (containsAny(normalized, ['改成', '修改', '更新', '调整', 'modify', 'update', 'set', 'change', '改到', '设为', '变更为']) && Object.keys(jsonObjectValue(args.parameters) ?? {}).length > 0) return 'direct_parameter_update'
  if (component && missingInputs.length === 0) return 'parameter_modeling'
  return 'guided_design'
}

function isReadOnlyIntent(intent: WorkflowIntent): boolean {
  return ['guided_design', 'task_execution', 'retrieval_comparison', 'template_recommendation'].includes(intent)
}

function recommendedToolsForIntent(
  intent: WorkflowIntent,
  component: McDesignComponent | undefined,
  missingInputs: string[],
): string[] {
  const hasMissing = missingInputs.length > 0 || !component
  if (hasMissing && !toolIntentCanProceedWithoutInputs(intent)) {
    return ['mc_design_classify_requirement', 'AskUserQuestion']
  }
  switch (intent) {
    case 'task_execution': return ['mc_design_query_tasks', 'mc_design_recommend_templates', 'mc_design_estimate_parameters']
    case 'retrieval_comparison': return ['mc_design_query_tasks', 'mc_design_lookup_knowledge']
    case 'template_recommendation': return ['mc_design_recommend_templates']
    case 'parameter_modeling': return ['mc_design_recommend_templates', 'mc_design_estimate_parameters', 'mc_design_prepare_template_workspace']
    case 'direct_parameter_update': return ['mc_design_prepare_template_workspace', 'mc_design_filter_nx_expressions', 'mc_design_nx_call_tool']
    case 'performance_design': return ['mc_design_lookup_knowledge', 'mc_design_recommend_templates', 'mc_design_estimate_parameters']
    case 'report_generation': return ['mc_design_generate_report_artifacts']
    case 'dfmea_generation': return ['mc_design_generate_dfmea_artifact']
    case 'drawing_template_update': return component === 'conrod'
      ? ['mc_design_prepare_template_workspace', 'mc_design_generate_conrod_drawing']
      : ['AskUserQuestion']
    case 'optimization': return ['mc_design_nx_health', 'mc_design_nx_call_tool']
    case 'nx_session_management': return ['mc_design_find_nx', 'mc_design_nx_health', 'mc_design_open_nx']
    default: return ['mc_design_classify_requirement']
  }
}

function toolIntentCanProceedWithoutInputs(intent: WorkflowIntent): boolean {
  return ['task_execution', 'retrieval_comparison', 'report_generation', 'dfmea_generation', 'drawing_template_update', 'direct_parameter_update', 'optimization', 'template_recommendation', 'nx_session_management', 'parameter_modeling'].includes(intent)
}

function guidedInputOptions(
  component: McDesignComponent | undefined,
  missingInputs: string[],
): Record<string, JsonObject> {
  if (!component || missingInputs.length === 0) return {}
  const options = GUIDED_INPUT_OPTIONS[component] ?? {}
  return Object.fromEntries(
    missingInputs
      .map(key => [key, options[key]])
      .filter((entry): entry is [string, JsonObject] => Boolean(entry[1])),
  )
}

const GUIDED_INPUT_OPTIONS: Record<McDesignComponent, Record<string, JsonObject>> = {
  conrod: {},
  crankshaft: {},
  camshaft: {
    cam_lift_mm: {
      header: '凸轮升程',
      question: '凸轮升程 cam_lift_mm 是多少？这是气门最大开启高度的关键参数。',
      options: [
        { label: '8 mm', description: '适用于经济性取向或低中速工况' },
        { label: '9 mm', description: '适用于 X14N 基准附近的均衡工况' },
        { label: '10 mm', description: '适用于进气性能提升取向' },
      ],
    },
    base_circle_diameter_mm: {
      header: '基圆直径',
      question: '基圆直径 base_circle_diameter_mm 是多少？基圆决定凸轮轴的强度和尺寸包络。',
      options: [
        { label: '32 mm', description: '适用于小尺寸包络参考' },
        { label: '60 mm', description: '适用于 X14N 模板包络参考' },
        { label: '36 mm', description: '适用于高升程变体参考' },
      ],
    },
    valve_duration_deg: {
      header: '持续角',
      question: '气门开启持续角 valve_duration_deg 是多少？影响发动机进排气特性。',
      options: [
        { label: '220°', description: '经济性或低速扭矩取向' },
        { label: '230°', description: 'X14N 基准模板参考' },
        { label: '250°', description: '高升程变体参考' },
      ],
    },
    valve_count: {
      header: '气门数量',
      question: '气门数量 valve_count 是多少？决定凸轮布置和气门机构匹配。',
      options: [
        { label: '8', description: '四缸两气门参考' },
        { label: '16', description: '四缸四气门参考' },
        { label: '24', description: '六缸四气门参考' },
      ],
    },
    shaft_journal_diameter_mm: {
      header: '轴颈直径',
      question: '轴颈直径 shaft_journal_diameter_mm 是多少？这是凸轮轴轴承支撑部位的直径。',
      options: [
        { label: '24 mm', description: '小尺寸支撑参考' },
        { label: '40 mm', description: 'X14N 模板支撑参考' },
        { label: '28 mm', description: '历史任务均衡参考' },
      ],
    },
    cam_lobe_width_mm: {
      header: '凸角宽度',
      question: '凸轮凸角宽度 cam_lobe_width_mm 是多少？影响接触应力和磨损寿命。',
      options: [
        { label: '12 mm', description: '小尺寸凸角参考' },
        { label: '21 mm', description: 'X14N 模板凸角参考' },
        { label: '15 mm', description: '历史任务均衡参考' },
      ],
    },
  },
}

function nextToolForIntent(
  intent: WorkflowIntent,
  component: McDesignComponent | undefined,
  missingInputs: string[],
): string {
  return recommendedToolsForIntent(intent, component, missingInputs)[0] ?? 'AskUserQuestion'
}

function collectParameters(
  task: McDesignTask | undefined,
  args: JsonObject,
  text: string,
): Record<string, number | string> {
  return {
    ...(task?.explicitParameters ?? {}),
    ...(task?.performanceParameters ?? {}),
    ...extractParametersFromText(text),
    ...sanitizeParameters(jsonObjectValue(args.parameters)),
    ...sanitizeParameters(jsonObjectValue(args.nx_parameters)),
  }
}

function sanitizeParameters(value: JsonObject | undefined): Record<string, number | string> {
  const result: Record<string, number | string> = {}
  for (const [key, raw] of Object.entries(value ?? {})) {
    if (typeof raw === 'string' || typeof raw === 'number') {
      result[key] = raw
    }
  }
  return result
}

function extractParametersFromText(text: string): Record<string, number> {
  const result: Record<string, number> = {}
  const regex = /([a-zA-Z][a-zA-Z0-9_]{2,})\s*[:=]\s*(-?\d+(?:\.\d+)?)/g
  for (const match of text.matchAll(regex)) {
    const key = match[1]
    const value = Number(match[2])
    if (key && Number.isFinite(value)) result[key] = value
  }
  return result
}

function selectBestLocalTemplate(
  component: McDesignComponent,
  parameters: Record<string, number | string>,
): McDesignTemplate | undefined {
  return MC_DESIGN_TEMPLATES
    .filter(template => template.component === component)
    .map(template => ({
      template,
      score: Number(scoreTemplate(parameters, template).score ?? 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.template
}

function scoreTemplate(
  parameters: Record<string, number | string>,
  template: McDesignTemplate,
): JsonObject {
  const nominal = template.nominalParameters ?? {}
  const implementation = templateImplementationStatus(template)
  const runnableBonus = implementation.local_part_exists ? 0.06 : -0.25
  const stabilityBonus = template.classificationAttributes?.templateLevel === 'parametric-master' ? 0.03 : 0
  const keys = Object.keys(nominal).filter(key => numeric(parameters[key]) !== undefined && numeric(nominal[key]) !== undefined)
  if (keys.length === 0) {
    const fallbackScore = clampNumber(0.5 + runnableBonus + stabilityBonus, 0, 1)
    return {
      score: Number(fallbackScore.toFixed(4)),
      distance: null,
      coverage: 0,
      contributions: [],
      local_runnable: implementation.local_part_exists,
    }
  }
  const contributions = keys.map(key => {
    const query = numeric(parameters[key]) ?? 0
    const target = numeric(nominal[key]) ?? 0
    const scale = Math.max(Math.abs(target), 1)
    const normalized_delta = Math.abs(query - target) / scale
    return { key, query, target, normalized_delta }
  })
  const distance = Math.sqrt(
    contributions.reduce((sum, item) => sum + item.normalized_delta ** 2, 0) / contributions.length,
  )
  const coverage = keys.length / Math.max(Object.keys(nominal).length, 1)
  const baseScore = 1 / (1 + distance)
  const score = clampNumber(baseScore + coverage * 0.03 + runnableBonus + stabilityBonus, 0, 1)
  return {
    score: Number(score.toFixed(4)),
    distance: Number(distance.toFixed(4)),
    coverage: Number(coverage.toFixed(4)),
    contributions,
    local_runnable: implementation.local_part_exists,
  }
}

function templateImplementationStatus(template: McDesignTemplate): JsonObject {
  const localPartPath = template.localPartPath
    ? resolve(PROJECT_ROOT, template.localPartPath)
    : undefined
  const localFolderPath = template.localFolderPath
    ? resolve(PROJECT_ROOT, template.localFolderPath)
    : undefined
  const localDrawingTemplatePath = template.localDrawingTemplatePath
    ? resolve(PROJECT_ROOT, template.localDrawingTemplatePath)
    : undefined

  return {
    local_part_path: localPartPath,
    local_part_exists: localPartPath ? existsSync(localPartPath) : false,
    local_folder_path: localFolderPath,
    local_folder_exists: localFolderPath ? existsSync(localFolderPath) : false,
    local_drawing_template_path: localDrawingTemplatePath,
    local_drawing_template_exists: localDrawingTemplatePath ? existsSync(localDrawingTemplatePath) : false,
    nx_drive_parameters: template.nxDriveParameters,
  }
}

const CRANKSHAFT_TEMPLATE_BASELINE_NX_PARAMETERS: Record<string, Record<string, number>> = {
  'TC-TPL-CRANK-B': {
    CS_M_DIA: 120,
    CS_M_GRD_W: 47,
    CS_Q_RAD: 90,
    CR_J_AX_DIA: 92,
    CS_C_W: 49,
    WB_T: 33,
  },
}

const CAMSHAFT_TEMPLATE_BASELINE_NX_PARAMETERS: Record<string, Record<string, number>> = {
  'TC-TPL-CAM-A': {
    CV_BC_DIA: 60,
    CV_J_DIA: 40,
    CV_INL_W: 21,
    CV_EXL_W: 21,
    CV_BRKL_W: 21,
  },
  'TC-TPL-CAM-B': {
    CV_BC_DIA: 60,
    CV_J_DIA: 40,
    CV_INL_W: 21,
    CV_EXL_W: 21,
    CV_BRKL_W: 21,
  },
  'TC-TPL-CAM-C': {
    CV_BC_DIA: 60,
    CV_J_DIA: 40,
    CV_INL_W: 21,
    CV_EXL_W: 21,
    CV_BRKL_W: 21,
  },
}

function fitParametersToTemplateEnvelope(
  component: McDesignComponent | undefined,
  rawParameters: Record<string, number>,
  template: McDesignTemplate | undefined,
): {
  parameters: Record<string, number>
  ranges: Record<string, JsonObject>
  notes: JsonObject[]
} {
  if (!component) return { parameters: rawParameters, ranges: {}, notes: [] }
  const ranges = buildNxParameterRanges(component)
  const fitted: Record<string, number> = {}
  const notes: JsonObject[] = []

  for (const [paramId, rawValue] of Object.entries(rawParameters)) {
    const range = ranges[paramId]
    if (!range || range.min === range.max) {
      fitted[paramId] = rawValue
      continue
    }

    const nextValue = clampNumber(rawValue, range.min, range.max)
    fitted[paramId] = roundEngineeringValue(nextValue)
    if (nextValue !== rawValue) {
      notes.push({
        param_id: paramId,
        raw_value: rawValue,
        recommended_value: fitted[paramId],
        range: [range.min, range.max],
        template_id: template?.id,
        reason: 'fit_to_local_runnable_template_range',
      })
    }
  }

  return {
    parameters: fitted,
    ranges: Object.fromEntries(
      Object.entries(ranges).map(([key, range]) => [key, {
        min: range.min,
        max: range.max,
        source_count: range.sourceCount,
        source: 'local_tasks_and_runnable_templates',
      }]),
    ),
    notes,
  }
}

function fitParametersToTemplateDriveBaseline(
  component: McDesignComponent | undefined,
  fittedParameters: Record<string, number>,
  rawParameters: Record<string, number>,
  template: McDesignTemplate | undefined,
): {
  parameters: Record<string, number>
  baseline: Record<string, number>
  notes: JsonObject[]
} {
  const baseline = template?.id
    ? component === 'crankshaft'
      ? CRANKSHAFT_TEMPLATE_BASELINE_NX_PARAMETERS[template.id]
      : component === 'camshaft'
        ? CAMSHAFT_TEMPLATE_BASELINE_NX_PARAMETERS[template.id]
        : undefined
    : undefined
  if (!baseline || (component !== 'crankshaft' && component !== 'camshaft')) {
    return {
      parameters: fittedParameters,
      baseline: {},
      notes: [],
    }
  }

  const maxRatio = component === 'camshaft' ? 0.02 : 0.01
  const minDelta = 0.1
  const trialParameters = { ...fittedParameters }
  const notes: JsonObject[] = []

  for (const [paramId, baselineValue] of Object.entries(baseline)) {
    if (rawParameters[paramId] === undefined && fittedParameters[paramId] === undefined) continue
    const target = rawParameters[paramId] ?? fittedParameters[paramId]
    const maxDelta = Math.max(Math.abs(baselineValue) * maxRatio, minDelta)
    const requestedDelta = target - baselineValue
    const safeDelta = target === baselineValue
      ? -minDelta
      : clampNumber(requestedDelta, -maxDelta, maxDelta)
    const nextValue = roundTemplateOffsetValue(baselineValue + safeDelta, baselineValue, target)
    trialParameters[paramId] = nextValue
    if (nextValue !== fittedParameters[paramId]) {
      notes.push({
        param_id: paramId,
        raw_value: rawParameters[paramId],
        range_fitted_value: fittedParameters[paramId],
        baseline_value: baselineValue,
        recommended_value: nextValue,
        template_id: template?.id,
        reason: 'fit_to_template_drive_parameter_reference',
      })
    }
  }

  return {
    parameters: trialParameters,
    baseline,
    notes,
  }
}

function roundTemplateOffsetValue(value: number, baselineValue: number, target: number): number {
  let rounded = Math.round(value)
  if (rounded === baselineValue) {
    const direction = target === baselineValue
      ? -1
      : Math.sign(target - baselineValue) || -1
    rounded = baselineValue + direction
  }
  return rounded
}

function buildNxParameterRanges(component: McDesignComponent): Record<string, { min: number; max: number; sourceCount: number }> {
  const samples = [
    ...MC_DESIGN_TASKS
      .filter(task => task.component === component)
      .map(task => ({
        ...(task.explicitParameters ?? {}),
        ...(task.performanceParameters ?? {}),
      })),
    ...MC_DESIGN_TEMPLATES
      .filter(template => template.component === component && templateImplementationStatus(template).local_part_exists)
      .map(template => template.nominalParameters ?? {}),
  ]

  const valuesByParam = new Map<string, number[]>()
  for (const sample of samples) {
    const computed = computeNxParameters(component, sample)
    for (const [key, value] of Object.entries(computed)) {
      if (!Number.isFinite(value)) continue
      const current = valuesByParam.get(key) ?? []
      current.push(value)
      valuesByParam.set(key, current)
    }
  }

  return Object.fromEntries(
    [...valuesByParam.entries()]
      .filter(([, values]) => values.length > 0)
      .map(([key, values]) => {
        const min = Math.min(...values)
        const max = Math.max(...values)
        return [key, {
          min: roundEngineeringValue(min),
          max: roundEngineeringValue(max),
          sourceCount: values.length,
        }]
      }),
  )
}

function roundEngineeringValue(value: number): number {
  return Number(value.toFixed(4))
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeNxParameters(
  component: McDesignComponent | undefined,
  parameters: Record<string, number | string>,
): Record<string, number> {
  const result: Record<string, number> = {}
  if (!component) return result

  const p = paramLookup(parameters)
  const relevantKnowledge = MC_DESIGN_KNOWLEDGE.filter(
    k => k.component === component && k.category === 'experience_formula' && k.formula,
  )

  for (const entry of relevantKnowledge) {
    const value = evalFormula(entry.formula!, entry.paramId, p)
    if (Number.isFinite(value) && value !== undefined) {
      result[entry.paramId] = value
    }
  }

  return result
}

function evalFormula(
  formula: string,
  paramId: string,
  p: (name: string) => number | undefined,
): number | undefined {
  const expr = formula
    .replace(/\bmax\s*\(/gi, 'Math.max(')
    .replace(/\bmin\s*\(/gi, 'Math.min(')
    .replace(/\b([a-z_]+[a-z0-9_]*)\b/gi, (match) => {
      const val = p(match)
      return val !== undefined ? String(val) : `NaN`
    })
  try {
    const evaluated = Function('Math', `return (${expr})`)(Math)
    return Number.isFinite(evaluated) ? evaluated : undefined
  } catch {
    return undefined
  }
}

function paramLookup(params: Record<string, number | string>): (name: string) => number | undefined {
  return (name: string) => {
    if (!name || typeof name !== 'string') return undefined
    const direct = numeric(params[name])
    if (direct !== undefined) return direct
    const withMm = numeric(params[`${name}_mm`])
    if (withMm !== undefined) return withMm
    const withoutMm = name.endsWith('_mm') ? numeric(params[name.slice(0, -3)]) : undefined
    if (withoutMm !== undefined) return withoutMm
    return undefined
  }
}

function buildChecks(
  component: McDesignComponent | undefined,
  parameters: Record<string, number | string>,
  nxParameters?: Record<string, number>,
): JsonObject[] {
  if (!component) return []
  const checks: JsonObject[] = []
  const p = paramLookup(parameters)

  const relevantRules = MC_DESIGN_KNOWLEDGE.filter(
    k => k.component === component && k.category === 'check_rule' && k.rule,
  )

  for (const entry of relevantRules) {
    if (component === 'crankshaft' && entry.id === 'CRANK-CHECK-OVERLAP' && isCrankshaftTemplateDriveTrial(nxParameters ?? {})) {
      continue
    }
    const value = evalRule(entry.rule!, entry.paramId, p, nxParameters ?? {})
    checks.push({
      id: entry.id,
      expression: entry.rule,
      pass: value?.ok ?? false,
      value: value?.actual,
      range: value?.range,
    })
  }

  if (component === 'conrod') {
    const stroke = p('stroke_mm') ?? p('stroke')
    const crankRadius = p('crank_radius_mm') ?? p('crank_radius')
    if (stroke !== undefined && crankRadius !== undefined) {
      checks.push({
        id: 'CONROD-STROKE-RADIUS',
        expression: 'stroke_mm ≈ 2 * crank_radius_mm',
        pass: Math.abs(stroke - 2 * crankRadius) <= 1,
        value: { stroke_mm: stroke, crank_radius_mm: crankRadius },
      })
    }
  }
  if (component === 'crankshaft') {
    const cylinders = p('cylinder_count')
    checks.push({
      id: 'CRANK-CYLINDER-COUNT',
      expression: 'cylinder_count >= 1',
      pass: cylinders === undefined || cylinders >= 1,
      value: cylinders,
    })
  }
  if (component === 'camshaft') {
    const lift = p('cam_lift_mm') ?? p('cam_lift')
    checks.push({
      id: 'CAM-LIFT-RANGE',
      expression: '4 <= cam_lift_mm <= 16',
      pass: lift === undefined || (lift >= 4 && lift <= 16),
      value: lift,
    })
  }
  return checks
}

function isCrankshaftTemplateDriveTrial(nxParameters: Record<string, number>): boolean {
  return Object.values(CRANKSHAFT_TEMPLATE_BASELINE_NX_PARAMETERS).some(baseline => {
    const required = ['CS_M_DIA', 'CR_J_AX_DIA', 'CS_Q_RAD'] as const
    return required.every(paramId => {
      const value = nxParameters[paramId]
      const base = baseline[paramId]
      if (!Number.isFinite(value) || !Number.isFinite(base)) return false
      return Math.abs(value - base) <= Math.max(1, Math.abs(base) * 0.011)
    })
  })
}

function evalRule(
  rule: string,
  paramId: string | undefined,
  p: (name: string) => number | undefined,
  nxParams: Record<string, number>,
): { ok: boolean; actual?: number; range?: string } | undefined {
  const rangeMatch = rule.match(/\[(\d+\.?\d*)\s*,\s*(\d+\.?\d*)\]/)
  if (!rangeMatch) return undefined
  const lo = Number(rangeMatch[1])
  const hi = Number(rangeMatch[2])

  const exprPart = rule.split('should be in')[0]?.trim()
  if (!exprPart) return undefined

  const resolvedExpr = exprPart.replace(/\b([A-Z][A-Z0-9_]+|[a-z_]+[a-z0-9_]*)\b/gi, (match) => {
    if (!match || typeof match !== 'string') return 'NaN'
    const n = nxParams[match] ?? p(match)
    return n !== undefined ? String(n) : 'NaN'
  })

  try {
    const actual = Function(`return (${resolvedExpr})`)()
    if (Number.isFinite(actual)) {
      return { ok: actual >= lo && actual <= hi, actual, range: `[${lo}, ${hi}]` }
    }
  } catch {
    // evaluation failed
  }

  return { ok: false, range: `[${lo}, ${hi}]` }
}

async function ensureArtifactDir(extra: ToolCallExtra): Promise<string> {
  const configDir = process.env.BEYA_CONFIG_DIR
  const cwdRoot = process.env.BEYA_MC_DESIGN_ARTIFACT_DIR || join(configDir || process.cwd(), 'mc-design-artifacts')
  const dir = join(cwdRoot, safeSegment(extra.sessionId || extra.taskId || 'session'))
  await mkdir(dir, { recursive: true })
  return dir
}

async function collectAssetEntries(
  root: string,
  current: string,
  out: JsonObject[],
  limit: number,
): Promise<void> {
  if (out.length >= limit) return
  let entries: string[]
  try {
    entries = await readdir(current)
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= limit) return
    const path = join(current, entry)
    try {
      const info = await stat(path)
      out.push({
        path: path.replace(root, '').replace(/^[/\\]/, ''),
        type: info.isDirectory() ? 'directory' : 'file',
        size: info.size,
      })
      if (info.isDirectory()) await collectAssetEntries(root, path, out, limit)
    } catch {
      // Ignore broken symlinks or permission denied entries.
    }
  }
}

function normalizeComponent(value: unknown): McDesignComponent | undefined {
  const raw = normalizedLowerNoSpace(value)
  return COMPONENT_ALIASES[raw]
}

function inferComponent(text: string): McDesignComponent | undefined {
  const normalized = normalizedLowerNoSpace(text)
  return Object.entries(COMPONENT_ALIASES).find(([alias]) => normalized.includes(alias))?.[1]
}

function containsAny(text: string, candidates: string[]): boolean {
  return candidates.some(candidate => text.includes(normalizedText(candidate)))
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function jsonObjectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizedLowerNoSpace(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff]/g, '')
}

function normalizedText(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '')
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item'
}

function stringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    return items.length > 0 ? items : undefined
  }
  return undefined
}

function numberArray(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    return items.length > 0 ? items : undefined
  }
  return undefined
}

function timestampSegment(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function jsonResult(data: unknown, isError = false): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(data, null, 2),
    }],
    isError,
  }
}
