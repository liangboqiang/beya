import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
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

type WorkflowIntent =
  | 'guided_design'
  | 'task_execution'
  | 'retrieval_comparison'
  | 'parameter_modeling'
  | 'direct_parameter_update'
  | 'performance_design'
  | 'report_generation'
  | 'drawing_template_update'
  | 'optimization'
  | 'template_recommendation'
  | 'nx_session_management'

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
    component,
    task_id: task?.id,
    extracted_parameters: parameters,
    missing_inputs: missingInputs,
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
      return {
        template,
        ...score,
        score: Number(score.score ?? 0),
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, positiveInteger(args.limit) ?? 5)

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    component,
    query_parameters: parameters,
    recommendations: candidates,
    confirmation_required: true,
  }
}

export function estimateDesignParameters(args: JsonObject): JsonObject {
  const task = getMcDesignTask(stringValue(args.task_id) || stringValue(args.taskId))
  const template = getMcDesignTemplate(stringValue(args.template_id))
  const text = stringValue(args.request_text) || stringValue(args.text) || task?.requirementText || ''
  const component = normalizeComponent(args.component) || template?.component || task?.component || inferComponent(text)
  const supplied = collectParameters(task, args, text)
  const nominal = template?.nominalParameters ?? {}
  const parameters = {
    ...nominal,
    ...supplied,
  }
  const missingInputs = component
    ? REQUIRED_INPUTS[component].filter(key => parameters[key] === undefined)
    : []

  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    component,
    task_id: task?.id,
    template_id: template?.id,
    parameters,
    checks: buildChecks(component, parameters),
    missing_inputs: missingInputs,
    requires_confirmation: true,
    instruction: 'Review the estimated parameters and pass confirmed: true before any NX write operation.',
  }
}

function planWorkflow(args: JsonObject): JsonObject {
  const classified = classifyRequirement(args)
  const intent = classified.intent as WorkflowIntent
  const component = classified.component as McDesignComponent | undefined
  const missingInputs = Array.isArray(classified.missing_inputs)
    ? classified.missing_inputs as string[]
    : []
  return {
    ok: true,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    intent,
    component,
    task_id: classified.task_id,
    missing_inputs: missingInputs,
    recommended_tools: recommendedToolsForIntent(intent, component, missingInputs),
    side_effects: intent === 'guided_design' || intent === 'retrieval_comparison' || intent === 'template_recommendation'
      ? []
      : ['requires explicit confirmation before writing files, launching NX, or generating artifacts'],
    next_recommended_tool: nextToolForIntent(intent, component, missingInputs),
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
    ? resolve(process.cwd(), template.localFolderPath)
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
    workspace_folder: workspaceFolder,
    manifest_path: manifestPath,
    source_copied: copied,
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
  const runtimeRoot = resolve(process.cwd(), MC_DESIGN_RUNTIME_ROOT)
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
  const reportPath = join(artifactDir, `design-report-${component}-${timestampSegment()}.md`)
  const parameters = {
    ...(task?.explicitParameters ?? {}),
    ...(template?.nominalParameters ?? {}),
    ...(jsonObjectValue(args.parameters) ?? {}),
  }
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
  }
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

function safeNxUnavailable(tool: string, args: JsonObject = {}): JsonObject {
  return {
    ok: false,
    data_source: MC_DESIGN_LOCAL_SOURCE,
    tool,
    error: 'nx_runtime_not_configured',
    message: 'The server is running, but the optional Siemens NX runtime/plugin is not configured in this source bundle.',
    input: args,
  }
}

async function runLocalChainCheck(args: JsonObject, extra: ToolCallExtra): Promise<JsonObject> {
  const classified = classifyRequirement(args)
  const recommendation = recommendTemplates(args)
  const templateId = stringValue(args.template_id) || stringValue((recommendation.recommendations as unknown[] | undefined)?.[0]?.['template']?.['id'])
  const estimate = estimateDesignParameters({ ...args, template_id: templateId })
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
    case 'mc_design_generate_report_artifacts':
      return jsonResult(await generateReportArtifacts(args, extra), args.confirmed !== true)
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
    case 'mc_design_prepare_nx_plugin':
    case 'mc_design_open_nx':
    case 'mc_design_close_nx':
    case 'mc_design_nx_health':
    case 'mc_design_nx_call_tool':
      return jsonResult(safeNxUnavailable(name, args), true)
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
    case 'mc_design_generate_report_artifacts': return 'Generate a fallback local design report after confirmation.'
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
  if (containsAny(normalized, ['report', 'doc', 'docx', '报告', '说明书'])) return 'report_generation'
  if (containsAny(normalized, ['drawing', 'draw', 'print', '图纸', '出图', '打印'])) return 'drawing_template_update'
  if (containsAny(normalized, ['optimize', 'optimization', '优化'])) return 'optimization'
  if (containsAny(normalized, ['compare', 'comparison', '对比', '比较'])) return 'retrieval_comparison'
  if (containsAny(normalized, ['query', 'task', 'ipm', 'ecs', 'ecr', 'qpp', '任务', '查询']) || task) return 'task_execution'
  if (containsAny(normalized, ['template', 'recommend', '模板', '推荐'])) return 'template_recommendation'
  if (containsAny(normalized, ['nx', 'open', 'close', 'reuse', 'ugraf'])) return 'nx_session_management'
  if (containsAny(normalized, ['performance', 'torque', 'efficiency', 'pressure', '性能', '扭矩', '压力'])) return 'performance_design'
  if (Object.keys(jsonObjectValue(args.parameters) ?? {}).length > 0) return 'direct_parameter_update'
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
  if (missingInputs.length > 0 || !component) return ['mc_design_classify_requirement', 'AskUserQuestion']
  switch (intent) {
    case 'task_execution': return ['mc_design_query_tasks', 'mc_design_recommend_templates', 'mc_design_estimate_parameters']
    case 'retrieval_comparison': return ['mc_design_query_tasks', 'mc_design_lookup_knowledge']
    case 'template_recommendation': return ['mc_design_recommend_templates']
    case 'parameter_modeling': return ['mc_design_recommend_templates', 'mc_design_estimate_parameters', 'mc_design_prepare_template_workspace']
    case 'direct_parameter_update': return ['mc_design_prepare_template_workspace', 'mc_design_filter_nx_expressions', 'mc_design_nx_call_tool']
    case 'performance_design': return ['mc_design_lookup_knowledge', 'mc_design_recommend_templates', 'mc_design_estimate_parameters']
    case 'report_generation': return ['mc_design_generate_report_artifacts']
    case 'drawing_template_update': return component === 'conrod'
      ? ['mc_design_prepare_template_workspace', 'mc_design_generate_conrod_drawing']
      : ['AskUserQuestion']
    case 'optimization': return ['mc_design_nx_health', 'mc_design_nx_call_tool']
    case 'nx_session_management': return ['mc_design_find_nx', 'mc_design_nx_health']
    default: return ['mc_design_classify_requirement']
  }
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

function scoreTemplate(
  parameters: Record<string, number | string>,
  template: McDesignTemplate,
): JsonObject {
  const nominal = template.nominalParameters ?? {}
  const keys = Object.keys(nominal).filter(key => numeric(parameters[key]) !== undefined && numeric(nominal[key]) !== undefined)
  if (keys.length === 0) {
    return { score: 0.5, distance: null, coverage: 0, contributions: [] }
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
  return {
    score: Number((1 / (1 + distance)).toFixed(4)),
    distance: Number(distance.toFixed(4)),
    coverage: Number((keys.length / Math.max(Object.keys(nominal).length, 1)).toFixed(4)),
    contributions,
  }
}

function buildChecks(
  component: McDesignComponent | undefined,
  parameters: Record<string, number | string>,
): JsonObject[] {
  if (!component) return []
  const checks: JsonObject[] = []
  if (component === 'conrod') {
    const stroke = numeric(parameters.stroke_mm)
    const crankRadius = numeric(parameters.crank_radius_mm)
    if (stroke !== undefined && crankRadius !== undefined) {
      checks.push({
        id: 'CONROD-STROKE-RADIUS',
        expression: 'stroke_mm ≈ 2 * crank_radius_mm',
        ok: Math.abs(stroke - 2 * crankRadius) <= 1,
        value: { stroke_mm: stroke, crank_radius_mm: crankRadius },
      })
    }
  }
  if (component === 'crankshaft') {
    const cylinders = numeric(parameters.cylinder_count)
    checks.push({
      id: 'CRANK-CYLINDER-COUNT',
      expression: 'cylinder_count >= 1',
      ok: cylinders === undefined || cylinders >= 1,
      value: cylinders,
    })
  }
  if (component === 'camshaft') {
    const lift = numeric(parameters.cam_lift_mm)
    checks.push({
      id: 'CAM-LIFT-RANGE',
      expression: '4 <= cam_lift_mm <= 16',
      ok: lift === undefined || (lift >= 4 && lift <= 16),
      value: lift,
    })
  }
  return checks
}

async function ensureArtifactDir(extra: ToolCallExtra): Promise<string> {
  const root = process.env.BEYA_MC_DESIGN_ARTIFACT_DIR || join(process.cwd(), '.beya', 'mc-design-artifacts')
  const dir = join(root, safeSegment(extra.sessionId || extra.taskId || 'session'))
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
