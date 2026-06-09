import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ToolCallExtra } from '../types/serverRuntime.js'
import {
  getMcDesignLocalToolDefinitions,
  estimateDesignParameters,
} from '../services/mcDesignLocalTools.js'
import {
  MC_DESIGN_TASKS,
  MC_DESIGN_TEMPLATES,
  getMcDesignTemplate,
} from '../services/mcDesignLocalData.js'

let tmpDir: string | undefined
let originalCwd: string | undefined
let originalFetch: typeof globalThis.fetch | undefined
const repoRoot = process.cwd()

afterEach(async () => {
  if (originalFetch) {
    globalThis.fetch = originalFetch
    originalFetch = undefined
  }
  if (originalCwd) {
    process.chdir(originalCwd)
    originalCwd = undefined
  }
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('mc-design workflow scenarios', () => {
  const scenarios = [
    {
      name: 'no system task: vague conrod request should guide first',
      input: { request_text: '我要设计一个连杆' },
      intent: 'guided_design',
      should_query_tasks: false,
      requires_guidance: true,
      next: ['AskUserQuestion'],
      forbidden: ['mc_design_query_tasks', 'mc_design_generate_report_artifacts'],
    },
    {
      name: 'query task and execute: explicit IPM task request may query tasks',
      input: { request_text: '查询 IPM-CONROD-002 任务并继续参数化建模' },
      intent: 'task_execution',
      should_query_tasks: true,
      requires_guidance: false,
      next: ['mc_design_query_tasks', 'mc_design_recommend_templates'],
    },
    {
      name: 'guided execution: partial conrod parameters ask for missing inputs',
      input: {
        request_text: '我有缸径95、冲程90，帮我设计连杆',
        component: 'conrod',
        parameters: { bore_mm: 95, stroke_mm: 90 },
      },
      intent: 'guided_design',
      should_query_tasks: false,
      requires_guidance: true,
      next: ['AskUserQuestion'],
    },
    {
      name: 'retrieval comparison: compare local tasks without side effects',
      input: { request_text: '对比 IPM-CONROD-001 和 ECS-CONROD-003 的设计任务' },
      intent: 'retrieval_comparison',
      should_query_tasks: true,
      requires_guidance: false,
      next: ['mc_design_query_tasks'],
      forbidden: ['mc_design_open_nx', 'mc_design_generate_report_artifacts'],
    },
    {
      name: 'explicit conrod parameters: estimate before NX write',
      input: {
        request_text: '按这些参数设计连杆',
        component: 'conrod',
        parameters: fullConrodParameters(),
      },
      intent: 'parameter_modeling',
      should_query_tasks: false,
      requires_guidance: false,
      next: ['mc_design_recommend_templates', 'mc_design_estimate_parameters'],
    },
    {
      name: 'direct parameter edit: require copied template workspace and confirmation',
      input: {
        request_text: '直接把连杆 CR_A_CEN 改成 158.2',
        component: 'conrod',
        parameters: { CR_A_CEN: 158.2 },
      },
      intent: 'direct_parameter_update',
      should_query_tasks: false,
      requires_guidance: false,
      next: ['mc_design_prepare_template_workspace', 'mc_design_nx_call_tool'],
    },
    {
      name: 'performance conrod request: handle performance parameters',
      input: {
        request_text: '根据爆发压力18MPa、缸径100、冲程110设计高强度连杆',
        component: 'conrod',
        parameters: { burst_pressure_mpa: 18, bore_mm: 100, stroke_mm: 110 },
      },
      intent: 'performance_design',
      should_query_tasks: false,
      requires_guidance: true,
      next: ['mc_design_classify_requirement', 'AskUserQuestion'],
    },
    {
      name: 'report generation: only when user asks report',
      input: { request_text: '根据 IPM-CONROD-001 生成连杆设计说明书 doc' },
      intent: 'report_generation',
      should_query_tasks: true,
      requires_guidance: false,
      next: ['mc_design_generate_report_artifacts'],
    },
    {
      name: 'conrod drawing: use drawing template workflow only',
      input: { request_text: '给连杆生成图纸并打印' },
      intent: 'drawing_template_update',
      should_query_tasks: false,
      requires_guidance: true,
      next: ['mc_design_prepare_template_workspace', 'mc_design_generate_conrod_drawing'],
    },
    {
      name: 'optimization: use NX plugin optimization tools',
      input: { request_text: '打开连杆模板后做质量最小化优化' },
      intent: 'optimization',
      should_query_tasks: false,
      requires_guidance: true,
      next: ['mc_design_nx_call_tool'],
      plugin_tools: ['nx_get_optimization_tool_guide', 'nx_validate_optimization_study'],
    },
    {
      name: 'crankshaft ECS task: task execution for crankshaft',
      input: { request_text: '执行 ECS-CRANK-001 曲轴设计任务' },
      intent: 'task_execution',
      should_query_tasks: true,
      requires_guidance: false,
      next: ['mc_design_query_tasks', 'mc_design_recommend_templates'],
    },
    {
      name: 'crankshaft performance parameters: estimate and recommend',
      input: {
        request_text: '用缸径110、冲程125、六缸、爆发压力18MPa设计曲轴',
        component: 'crankshaft',
        parameters: {
          bore_mm: 110,
          stroke_mm: 125,
          cylinder_count: 6,
          burst_pressure_mpa: 18,
        },
      },
      intent: 'performance_design',
      should_query_tasks: false,
      requires_guidance: false,
      next: ['mc_design_recommend_templates', 'mc_design_estimate_parameters'],
    },
    {
      name: 'camshaft parameterization: template-only modeling',
      input: { request_text: '用 X14N 模板参数化设计凸轮轴' },
      intent: 'parameter_modeling',
      should_query_tasks: false,
      requires_guidance: true,
      next: ['mc_design_recommend_templates', 'mc_design_prepare_template_workspace'],
    },
    {
      name: 'camshaft optimization: no create-new camshaft modeling',
      input: { request_text: '优化凸轮轴升程和持续角，不要新建模型' },
      intent: 'optimization',
      should_query_tasks: false,
      requires_guidance: true,
      next: ['mc_design_nx_call_tool'],
      forbidden: ['mc_design_generate_nx_artifact'],
    },
    {
      name: 'QPP fields: source-specific fields are queryable',
      input: { request_text: '查询 QPP 中的连杆性能目标并做模板推荐' },
      intent: 'task_execution',
      should_query_tasks: true,
      requires_guidance: false,
      next: ['mc_design_query_tasks', 'mc_design_recommend_templates'],
    },
    {
      name: 'ECR fields: change reason feeds report and modeling',
      input: { request_text: '按 ECR-CONROD-005 的变更原因修改连杆参数' },
      intent: 'task_execution',
      should_query_tasks: true,
      requires_guidance: false,
      next: ['mc_design_query_tasks', 'mc_design_estimate_parameters'],
    },
    {
      name: 'template recommendation: mathematical similarity is explicit',
      input: { request_text: '根据这些参数推荐最相似的曲轴模板', component: 'crankshaft' },
      intent: 'template_recommendation',
      should_query_tasks: false,
      requires_guidance: true,
      next: ['mc_design_recommend_templates'],
    },
    {
      name: 'simple design should not auto-report or auto-DFMEA',
      input: { request_text: '设计一个曲轴', component: 'crankshaft' },
      intent: 'guided_design',
      should_query_tasks: false,
      requires_guidance: true,
      forbidden: ['mc_design_generate_report_artifacts', 'mc_design_tc_writeback_mock'],
    },
    {
      name: 'unsupported crankshaft drawing blocks instead of auto drawing',
      input: { request_text: '给曲轴自动出图' },
      intent: 'drawing_template_update',
      should_query_tasks: false,
      requires_guidance: false,
      blockers: ['drawing_template_only_conrod_supported'],
      forbidden: ['mc_design_nx_call_tool'],
    },
    {
      name: 'NX session management: reuse running NX and do not spawn conflicts',
      input: { request_text: 'NX 已经开着了，打开模板时不要再新开 NX' },
      intent: 'nx_session_management',
      should_query_tasks: false,
      requires_guidance: true,
      guardrails: ['reuse_running_nx_before_launch'],
      next: ['mc_design_open_nx'],
    },
  ] as const

  for (const scenario of scenarios) {
    it(`plans scenario: ${scenario.name}`, async () => {
      const plan = await executeTool('mc_design_plan_workflow', scenario.input)

      expect(plan.ok).toBe(true)
      expect(plan.intent).toBe(scenario.intent)
      expect(plan.should_query_tasks).toBe(scenario.should_query_tasks)
      expect(plan.requires_guidance).toBe(scenario.requires_guidance)
      expect(plan.side_effects_allowed).toBe(false)
      for (const toolName of scenario.next ?? []) {
        expect(plan.recommended_next_tools).toContain(toolName)
      }
      for (const toolName of scenario.forbidden ?? []) {
        expect(plan.recommended_next_tools).not.toContain(toolName)
      }
      for (const pluginTool of scenario.plugin_tools ?? []) {
        expect(plan.plugin_tool_hints).toContain(pluginTool)
      }
      for (const blocker of scenario.blockers ?? []) {
        expect(plan.blockers).toContain(blocker)
      }
      for (const guardrail of scenario.guardrails ?? []) {
        expect(plan.guardrails).toContain(guardrail)
      }
    })
  }

  it('keeps task fixtures rich enough for inconsistent IPM/ECS/TC/ECR/QPP fields', () => {
    const sources = new Set(MC_DESIGN_TASKS.map(task => task.source))
    expect(sources).toEqual(new Set(['ipm', 'ecs', 'tc', 'ecr', 'qpp']))
    expect(MC_DESIGN_TASKS.length).toBeGreaterThanOrEqual(14)
    expect(MC_DESIGN_TASKS).toContainEqual(expect.objectContaining({
      id: 'ECR-CONROD-005',
      sourceFields: expect.objectContaining({
        change_reason: expect.any(String),
        affected_item_id: expect.any(String),
      }),
    }))
    expect(MC_DESIGN_TASKS).toContainEqual(expect.objectContaining({
      id: 'QPP-CONROD-006',
      performanceParameters: expect.objectContaining({
        peak_tensile_load_kn: expect.any(Number),
      }),
    }))
  })

  it('uses distinct .prt files in template folders instead of one shared file path', async () => {
    expect(MC_DESIGN_TEMPLATES.length).toBeGreaterThanOrEqual(10)
    const partPaths = MC_DESIGN_TEMPLATES
      .map(template => template.localPartPath)
      .filter((value): value is string => Boolean(value))
    expect(new Set(partPaths).size).toBe(partPaths.length)

    for (const template of MC_DESIGN_TEMPLATES) {
      expect(template.localFolderPath).toBeTruthy()
      expect(template.localPartPath).toContain(`${template.id}/`)
      await expect(fs.stat(path.join(process.cwd(), template.localPartPath!))).resolves.toEqual(
        expect.objectContaining({ size: expect.any(Number) }),
      )
    }
  })

  it('copies the whole template folder before any model or drawing update', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-template-workspace-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)

    const result = await executeTool('mc_design_prepare_template_workspace', {
      confirmed: true,
      template_id: 'TC-TPL-CONROD-A',
      workspace_name: 'conrod-copy-check',
    })

    const template = getMcDesignTemplate('TC-TPL-CONROD-A')!
    expect(result.ok).toBe(true)
    expect(result.copied_whole_folder).toBe(true)
    expect(result.template_id).toBe('TC-TPL-CONROD-A')
    expect(result.source_folder).toBe(path.join(repoRoot, template.localFolderPath))
    expect(String(result.workspace_folder)).toContain('conrod-copy-check')
    expect(result.working_part_path).not.toBe(path.join(repoRoot, template.localPartPath!))
    expect(result.working_part_path).toContain(String(result.workspace_folder))
    expect(result.working_drawing_template_path).toContain(String(result.workspace_folder))
    await expect(fs.stat(String(result.working_part_path))).resolves.toEqual(
      expect.objectContaining({ size: expect.any(Number) }),
    )
    await expect(fs.stat(String(result.working_drawing_template_path))).resolves.toEqual(
      expect.objectContaining({ size: expect.any(Number) }),
    )
  })

  it('does not generate report images as confirmed_missing unless explicitly allowed', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-report-gating-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)

    const blocked = await executeToolResult('mc_design_generate_report_artifacts', {
      confirmed: true,
      task_id: 'IPM-CONROD-001',
      template_id: 'TC-TPL-CONROD-A',
      parameters: { CR_A_CEN: 155.7 },
    })
    const blockedPayload = parseToolPayload(blocked) as Record<string, unknown>
    expect(blocked.isError).toBe(true)
    expect(blockedPayload.error).toBe('report_image_evidence_required')

    const allowed = await executeTool('mc_design_generate_report_artifacts', {
      confirmed: true,
      allow_confirmed_missing_images: true,
      include_dfmea: false,
      task_id: 'IPM-CONROD-001',
      template_id: 'TC-TPL-CONROD-A',
      parameters: { CR_A_CEN: 155.7 },
    })
    expect(allowed.ok).toBe(true)
    expect(allowed.report_format).toBe('docx')
    expect(allowed.dfmea_path).toBeUndefined()
    expect(String(allowed.report_path)).toMatch(/\.docx$/)
  }, 60_000)

  it('runs chain checks without report or DFMEA unless explicitly requested', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-chain-no-report-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
    const nxRoot = path.join(tmpDir, 'NX 11.0')
    const nxbin = path.join(nxRoot, 'NXBIN')
    await fs.mkdir(nxbin, { recursive: true })
    await fs.writeFile(path.join(nxbin, 'ugraf.exe'), '')

    originalFetch = globalThis.fetch
    globalThis.fetch = fakeNxFetch()

    const result = await executeTool('mc_design_run_local_chain_check', {
      task_id: 'IPM-CONROD-001',
      template_id: 'TC-TPL-CONROD-A',
      require_real_nx: true,
      confirmed: true,
      write_mode: 'same_value',
      base_url: 'http://nx.test/api',
      reference_root: path.join(tmpDir, 'missing-history'),
      extra_roots: [tmpDir],
    })

    expect(result.ok).toBe(true)
    expect(result.report_result).toBeUndefined()
    expect(result.dfmea_path).toBeUndefined()
  })

  it('supports report generation in chain checks only when explicitly requested', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-chain-report-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
    const nxRoot = path.join(tmpDir, 'NX 11.0')
    const nxbin = path.join(nxRoot, 'NXBIN')
    await fs.mkdir(nxbin, { recursive: true })
    await fs.writeFile(path.join(nxbin, 'ugraf.exe'), '')

    originalFetch = globalThis.fetch
    globalThis.fetch = fakeNxFetch()

    const result = await executeTool('mc_design_run_local_chain_check', {
      task_id: 'IPM-CONROD-001',
      template_id: 'TC-TPL-CONROD-A',
      require_real_nx: true,
      confirmed: true,
      write_mode: 'same_value',
      generate_report: true,
      include_dfmea: false,
      allow_confirmed_missing_images: true,
      base_url: 'http://nx.test/api',
      reference_root: path.join(tmpDir, 'missing-history'),
      extra_roots: [tmpDir],
    })

    expect(result.ok).toBe(true)
    expect(result.report_result).toEqual(expect.objectContaining({
      ok: true,
      report_format: 'docx',
    }))
    expect(result.report_result.dfmea_path).toBeUndefined()
  }, 60_000)

  it('estimates crankshaft and camshaft flows with performance-aware parameters', () => {
    const crank = estimateDesignParameters({
      task_id: 'QPP-CRANK-004',
      template_id: 'TC-TPL-CRANK-B',
    }) as { ok: boolean; nx_parameters: Record<string, number> }
    expect(crank.ok).toBe(true)
    expect(crank.nx_parameters.CS_Q_RAD).toBe(62.5)

    const cam = estimateDesignParameters({
      task_id: 'ECR-CAM-004',
      template_id: 'TC-TPL-CAM-B',
    }) as { ok: boolean; nx_parameters: Record<string, number> }
    expect(cam.ok).toBe(true)
    expect(cam.nx_parameters.CAM_LIFT).toBe(9.8)
  })
})

function fullConrodParameters(): Record<string, number> {
  return {
    body_height_mm: 248,
    head_gasket_thickness_mm: 1.5,
    compression_clearance_mm: 0.8,
    piston_compression_height_mm: 48,
    rod_journal_diameter_mm: 58,
    piston_pin_diameter_mm: 34,
    rod_bearing_thickness_mm: 2,
    crank_radius_mm: 45,
    stroke_mm: 90,
    bore_mm: 95,
    small_end_bushing_thickness_mm: 1.2,
  }
}

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await executeToolResult(toolName, input)
  expect(result.isError).not.toBe(true)
  return parseToolPayload(result) as Record<string, unknown>
}

async function executeToolResult(
  toolName: string,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  const tool = getMcDesignLocalToolDefinitions().find(
    definition => definition.name === toolName,
  )
  expect(tool?.execute).toBeTypeOf('function')
  return await tool!.execute!(input, fakeExtra())
}

function fakeExtra(): ToolCallExtra {
  return {
    taskId: 'test-task',
    sessionId: 'test-session',
    toolCallId: 'toolu_test',
    signal: new AbortController().signal,
    metadata: {},
  }
}

function parseToolPayload(result: CallToolResult): unknown {
  const block = result.content[0]
  if (!block || block.type !== 'text') {
    throw new Error('Expected text tool result')
  }
  return JSON.parse(block.text)
}

function fakeNxFetch(): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/health')) {
      return jsonResponse({ ok: true, data: 'heartbeat' })
    }
    if (url.endsWith('/tools')) {
      return jsonResponse({ ok: true, data: { tools: [] } })
    }
    const toolName = decodeURIComponent(url.split('/').pop() ?? '')
    if (toolName === 'Test') {
      return jsonResponse({ ok: true, data: { passed: true } })
    }
    if (toolName === 'OpenPart') {
      return jsonResponse({ ok: true, data: { part_opened: true } })
    }
    if (toolName === 'GetWorkPartInfo') {
      return jsonResponse({
        ok: true,
        data: {
          part_name: 'K08 conrod body',
          part_path: 'workspace\\K08_1004201_21_conrod_body_A.prt',
          has_write_access: true,
        },
      })
    }
    if (toolName === 'GetDriveParamsList') {
      return jsonResponse({
        ok: true,
        data: {
          expressions: [
            { std_id: 'CR_A_CEN', equation: 'CR_A_CEN=215' },
            { std_id: 'CR_B_DIA', equation: 'CR_B_DIA=85' },
            { std_id: 'CR_S_DIA', equation: 'CR_S_DIA=50' },
            { std_id: 'CR_R_W', equation: 'CR_R_W=25' },
            { std_id: 'CR_R_LEN', equation: 'CR_R_LEN=32' },
            { std_id: 'CR_BLT_CEN', equation: 'CR_BLT_CEN=87' },
          ],
        },
      })
    }
    if (toolName === 'BatchUpdateParams') {
      expect(JSON.parse(String(init?.body ?? '{}'))).toEqual({
        expressions: [
          { std_id: 'CR_A_CEN', value: '215' },
          { std_id: 'CR_B_DIA', value: '85' },
          { std_id: 'CR_S_DIA', value: '50' },
        ],
      })
      return jsonResponse({ ok: true, data: { updated: 3, failed: [] } })
    }
    return jsonResponse({ ok: false, message: `unexpected ${toolName}` }, 404)
  }) as typeof globalThis.fetch
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}
