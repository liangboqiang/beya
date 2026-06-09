import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ToolCallExtra } from '../types/serverRuntime.js'
import {
  classifyRequirement,
  estimateDesignParameters,
  getMcDesignLocalToolDefinitions,
  queryLocalTasks,
} from '../services/mcDesignLocalTools.js'
import {
  MC_DESIGN_TASKS,
  MC_DESIGN_TEMPLATES,
  getMcDesignTemplate,
} from '../services/mcDesignLocalData.js'

let tmpDir: string | undefined
let originalCwd: string | undefined
let originalFetch: typeof globalThis.fetch | undefined

async function removeTmpDir(dir: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code ?? '') || attempt === 5) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}

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
    await removeTmpDir(tmpDir)
    tmpDir = undefined
  }
})

describe('mc-design local tools', () => {
  it('loads template metadata from the project-owned runtime knowledge base', async () => {
    const template = getMcDesignTemplate('TC-TPL-CONROD-A')

    expect(MC_DESIGN_TEMPLATES.length).toBeGreaterThanOrEqual(10)
    expect(MC_DESIGN_TASKS.length).toBeGreaterThanOrEqual(10)
    expect(template?.localPartPath).toBe(
      'runtime/mc-design/dependencies/templates/TC-TPL-CONROD-A/K08_1004201_21_conrod_body_A.prt',
    )
    expect((template as { localFolderPath?: string }).localFolderPath).toBe(
      'runtime/mc-design/dependencies/templates/TC-TPL-CONROD-A',
    )
    expect((template as { localDrawingTemplatePath?: string }).localDrawingTemplatePath).toBe(
      'runtime/mc-design/dependencies/templates/TC-TPL-CONROD-A/K08_1004201_21_conrod_assembly_A.prt',
    )
    await expect(fs.stat(path.join(
      originalCwd ?? process.cwd(),
      template!.localPartPath!,
    ))).resolves.toEqual(expect.objectContaining({
      size: expect.any(Number),
    }))
    for (const templateId of ['TC-TPL-CRANK-A', 'TC-TPL-CAM-A']) {
      const localPartPath = getMcDesignTemplate(templateId)?.localPartPath
      expect(localPartPath).toBeTruthy()
      await expect(fs.stat(path.join(process.cwd(), localPartPath!))).resolves.toEqual(
        expect.objectContaining({ size: expect.any(Number) }),
      )
    }
  })

  it('lists project-owned mc-design knowledge and dependency assets', async () => {
    const tool = getMcDesignLocalToolDefinitions().find(
      definition => definition.name === 'mc_design_list_local_assets',
    )
    expect(tool?.execute).toBeTypeOf('function')

    const result = await tool!.execute!({}, fakeExtra())
    const payload = parseToolPayload(result) as {
      ok: boolean
      assets: Array<{ path: string; type: string }>
    }

    expect(payload.ok).toBe(true)
    expect(Array.isArray(payload.assets)).toBe(true)
    expect(payload.assets.length).toBeGreaterThan(10)
    expect(payload.assets.some((a: { type: string }) => a.type === 'file')).toBe(true)
    expect(payload.assets.some((a: { type: string }) => a.type === 'directory')).toBe(true)
  })

  it('queries local simulated IPM/ECS/TC tasks', () => {
    const result = queryLocalTasks({
      source: 'ipm',
      component: 'conrod',
    }) as { count: number; tasks: Array<{ id: string }> }

    expect(result.count).toBeGreaterThanOrEqual(1)
    expect(result.tasks.map(task => task.id)).toContain('IPM-CONROD-001')
  })

  it('recommends templates using mathematical similarity evidence', async () => {
    const tool = getMcDesignLocalToolDefinitions().find(
      definition => definition.name === 'mc_design_recommend_templates',
    )
    expect(tool?.execute).toBeTypeOf('function')

    const result = await tool!.execute!({
      task_id: 'ECS-CRANK-001',
      limit: 3,
    }, fakeExtra())
    const payload = parseToolPayload(result) as {
      ok: boolean
      recommendations: Array<{
        score: number
        distance: number
        coverage: number
        template: { id: string }
        contributions: Array<{ key: string; normalized_delta: number }>
      }>
    }

    expect(payload.ok).toBe(true)
    expect(payload.recommendations.length).toBeGreaterThan(0)
    expect(payload.recommendations[0]?.template.id).toBe('TC-TPL-CRANK-B')
    expect(payload.recommendations[0]?.contributions.length).toBeGreaterThan(0)
  })

  it('classifies a fixture requirement with complete conrod inputs', () => {
    const result = classifyRequirement({
      task_id: 'IPM-CONROD-001',
    }) as {
      mode: string
      component: string
      missing_inputs: unknown[]
      extracted_parameters: Record<string, number>
    }

    expect(result.component).toBe('conrod')
    expect(result.mode).toBe('task_execution')
    expect(result.missing_inputs).toEqual([])
    expect(result.extracted_parameters.bore_mm).toBe(95)
  })

  it('returns missing inputs instead of estimating incomplete conrod data', () => {
    const result = estimateDesignParameters({
      component: 'conrod',
      parameters: {
        bore_mm: 95,
        stroke_mm: 90,
      },
    }) as {
      ok: boolean
      missing_inputs: Array<{ key: string }>
    }

    expect(result.ok).toBe(false)
    expect(result.missing_inputs.map(input => input.key)).toContain('body_height_mm')
    expect(result.missing_inputs.map(input => input.key)).toContain('crank_radius_mm')
  })

  it('estimates conrod drive parameters and check rows from local formulas', () => {
    const result = estimateDesignParameters({
      task_id: 'IPM-CONROD-001',
      template_id: 'TC-TPL-CONROD-A',
    }) as {
      ok: boolean
      nx_parameters: Record<string, number>
      nxParameters?: Record<string, number>
      checks: Array<{ id: string; pass: boolean }>
      requires_confirmation: boolean
      requiresConfirmation?: boolean
    }

    expect(result.ok).toBe(true)
    expect(result.requires_confirmation).toBe(true)
    expect(result.requiresConfirmation).toBeUndefined()
    expect(result.nx_parameters.CR_A_CEN).toBe(155.7)
    expect(result.nx_parameters.CR_B_DIA).toBe(62)
    expect(result.nx_parameters.CR_S_DIA).toBe(36.4)
    expect(result.nxParameters).toBeUndefined()
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'CONROD-CHECK-LAMBDA', pass: true }),
    )
  })

  it('supports camshaft only through template parameterization, not create-new modeling', async () => {
    const estimate = estimateDesignParameters({
      task_id: 'IPM-CAM-001',
      template_id: 'TC-TPL-CAM-A',
    }) as {
      ok: boolean
      component: string
      nx_parameters: Record<string, number>
    }

    expect(estimate.ok).toBe(true)
    expect(estimate.component).toBe('camshaft')
    expect(estimate.nx_parameters.CAM_LIFT).toBe(8.5)

    const tool = getMcDesignLocalToolDefinitions().find(
      definition => definition.name === 'mc_design_generate_nx_artifact',
    )
    const result = await tool!.execute!({
      confirmed: true,
      component: 'camshaft',
      template_id: 'TC-TPL-CAM-A',
      parameters: estimate.nx_parameters,
    }, fakeExtra())
    const payload = parseToolPayload(result) as { ok: boolean; error: string }

    expect(payload.ok).toBe(false)
    expect(payload.error).toBe('template_parameterization_only')
  })

  it('filters isolated anonymous NX p-number expressions', async () => {
    const tool = getMcDesignLocalToolDefinitions().find(
      definition => definition.name === 'mc_design_filter_nx_expressions',
    )
    expect(tool?.execute).toBeTypeOf('function')

    const result = await tool!.execute!({
      expressions: [
        { std_id: 'CR_A_CEN', equation: 'CR_A_CEN=215' },
        { std_id: 'p105', equation: 'p105=CR_S_T/2+2' },
        { std_id: 'p999', equation: 'p999=42' },
      ],
    }, fakeExtra())
    const payload = parseToolPayload(result) as {
      ok: boolean
      expressions: Array<{ std_id: string; uncertainty?: string; relatedStandardParams?: string[] }>
      filtered_out: Array<{ std_id: string; filterReason?: string }>
      notes: unknown[]
    }

    expect(payload.ok).toBe(true)
    expect(payload.expressions.map(item => item.std_id)).toContain('CR_A_CEN')
    expect(payload.expressions).toContainEqual(expect.objectContaining({
      std_id: 'p105',
      uncertainty: 'anonymous_expression_related_to_standard_parameters',
    }))
    expect(payload.filtered_out).toContainEqual(expect.objectContaining({ std_id: 'p999' }))
    expect(payload.notes.length).toBe(1)
  })

  it('writes a local NX mock artifact only after confirmation', async () => {
    const tool = getMcDesignLocalToolDefinitions().find(
      definition => definition.name === 'mc_design_generate_nx_artifact',
    )
    expect(tool?.execute).toBeTypeOf('function')

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-local-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)

    const unconfirmed = await tool!.execute!({
      confirmed: false,
      component: 'conrod',
      template_id: 'TC-TPL-CONROD-A',
      parameters: { CR_A_CEN: 155.7 },
    }, fakeExtra())
    expect(unconfirmed.isError).toBe(true)

    const confirmed = await tool!.execute!({
      confirmed: true,
      component: 'conrod',
      template_id: 'TC-TPL-CONROD-A',
      parameters: { CR_A_CEN: 155.7 },
    }, fakeExtra())
    const payload = parseToolPayload(confirmed) as {
      artifact_path: string
      artifactPath?: string
    }

    expect(payload.artifact_path).toContain('mc-design-artifacts')
    expect(payload.artifactPath).toBeUndefined()
    await expect(fs.stat(payload.artifact_path)).resolves.toEqual(
      expect.objectContaining({ size: expect.any(Number) }),
    )
  })

  it('generates a DOCX design report artifact instead of markdown', async () => {
    const tool = getMcDesignLocalToolDefinitions().find(
      definition => definition.name === 'mc_design_generate_report_artifacts',
    )
    expect(tool?.execute).toBeTypeOf('function')

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-report-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)

    const result = await tool!.execute!({
      confirmed: true,
      allow_confirmed_missing_images: true,
      include_dfmea: false,
      task_id: 'IPM-CONROD-001',
      template_id: 'TC-TPL-CONROD-A',
      parameters: { CR_A_CEN: 155.7, CR_B_DIA: 62 },
    }, fakeExtra())
    const payload = parseToolPayload(result) as {
      ok: boolean
      report_path: string
      report_format: string
      reportPath?: string
    }

    expect(payload.ok).toBe(true)
    expect(['docx', 'markdown']).toContain(payload.report_format)
    await expect(fs.stat(payload.report_path)).resolves.toEqual(
      expect.objectContaining({ size: expect.any(Number) }),
    )
  }, 60_000)

  it('reuses an already-open copied conrod drawing template instead of blocking', async () => {
    const tool = getMcDesignLocalToolDefinitions().find(
      definition => definition.name === 'mc_design_generate_conrod_drawing',
    )
    expect(tool?.execute).toBeTypeOf('function')

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-drawing-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
    originalFetch = globalThis.fetch
    const calledTools: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const toolName = decodeURIComponent(url.split('/').pop() ?? '')
      calledTools.push(toolName)
      if (toolName === 'OpenPart') {
        return jsonResponse({ ok: false, message: '打开模型失败：文件已存在' })
      }
      if (toolName === 'GetWorkPartInfo') {
        return jsonResponse({
          ok: true,
          data: {
            part_name: 'K08_1004201_21_conrod_assembly_A',
            part_path: path.join(
              tmpDir!,
              'artifacts',
              'mc-design-local',
              'test-session',
              'template-workspaces',
              'copy',
              'K08_1004201_21_conrod_assembly_A.prt',
            ),
          },
        })
      }
      if (toolName === 'GetDrawingSheetNameList') {
        return jsonResponse({ ok: true, data: ['SHT1'] })
      }
      if (toolName === 'OpenDrawingSheet') {
        expect(JSON.parse(String(init?.body ?? '{}'))).toEqual({
          drawSheetName: 'SHT1',
        })
        return jsonResponse({ ok: true, data: 'opened' })
      }
      if (toolName === 'Updatedrawings') {
        return jsonResponse({ ok: true, data: 'updated' })
      }
      if (toolName === 'CreateImage') {
        expect(JSON.parse(String(init?.body ?? '{}'))).toEqual(
          expect.objectContaining({ filePath: expect.stringMatching(/conrod-drawing-.*\.png$/) }),
        )
        return jsonResponse({ ok: true, data: { file_path: 'drawing.png' } })
      }
      return jsonResponse({ ok: false, message: `unexpected ${toolName}` }, 404)
    }) as typeof globalThis.fetch

    const result = await tool!.execute!({
      confirmed: true,
      template_id: 'TC-TPL-CONROD-A',
      print: true,
      base_url: 'http://nx.test/api',
    }, fakeExtra())
    const payload = parseToolPayload(result) as {
      ok: boolean
      print_receipt_path: string
    }

    expect(payload.ok).toBe(true)
    expect(calledTools).toEqual([
      'OpenPart',
      'GetWorkPartInfo',
      'GetDrawingSheetNameList',
      'OpenDrawingSheet',
      'Updatedrawings',
      'CreateImage',
    ])
    expect(payload.print_receipt_path).toBeTruthy()
  })

  it('runs the local chain check through fixture data, NX mapping, same-value write, and report artifacts', async () => {
    const tool = getMcDesignLocalToolDefinitions().find(
      definition => definition.name === 'mc_design_run_local_chain_check',
    )
    expect(tool?.execute).toBeTypeOf('function')

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-chain-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
    const nxRoot = path.join(tmpDir, 'NX 11.0')
    const nxbin = path.join(nxRoot, 'NXBIN')
    await fs.mkdir(nxbin, { recursive: true })
    await fs.writeFile(path.join(nxbin, 'ugraf.exe'), '')

    originalFetch = globalThis.fetch
    const calledTools: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return jsonResponse({ ok: true, data: 'heartbeat' })
      }
      if (url.endsWith('/tools')) {
        return jsonResponse({ ok: true, data: { tools: [] } })
      }
      const toolName = decodeURIComponent(url.split('/').pop() ?? '')
      calledTools.push(toolName)
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
            part_nane: 'K08_1004201_21_连杆体',
            part_path: 'F:\\Desktop\\连杆2+图纸\\K08_1004201_21_连杆体.prt',
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
        return jsonResponse({ ok: true, data: { updated: 3 } })
      }
      return jsonResponse({ ok: false, message: `unexpected ${toolName}` }, 404)
    }) as typeof globalThis.fetch

    const result = await tool!.execute!({
      task_id: 'IPM-CONROD-001',
      template_id: 'TC-TPL-CONROD-A',
      require_real_nx: true,
      confirmed: true,
      write_mode: 'same_value',
      generate_report: true,
      include_dfmea: true,
      allow_confirmed_missing_images: true,
      base_url: 'http://nx.test/api',
      reference_root: path.join(tmpDir, 'missing-history'),
      extra_roots: [tmpDir],
    }, fakeExtra())
    const payload = parseToolPayload(result) as {
      ok: boolean
      blockers: string[]
      mappings: Array<{ matched: boolean }>
      report_result: { report_path: string; report_format: string }
      called_tools: string[]
    }

    expect(payload.ok).toBe(true)
    expect(payload.blockers).toEqual([])
    expect(payload.mappings.every(mapping => mapping.matched)).toBe(true)
    expect(payload.called_tools).toEqual([
      'Test',
      'OpenPart',
      'GetWorkPartInfo',
      'GetDriveParamsList',
      'BatchUpdateParams',
    ])
    await expect(fs.stat(payload.report_result.report_path)).resolves.toEqual(
      expect.objectContaining({ size: expect.any(Number) }),
    )
  }, 60_000)
})

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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}
