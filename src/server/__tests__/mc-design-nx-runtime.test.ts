import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  callNxPluginTool,
  discoverNxInstallations,
  filterNxExpressions,
  getNxPluginStatus,
  isNxWriteTool,
  mapNxParametersToExpressions,
  prepareProjectNxPlugin,
  resolveNxToolName,
  sameValueBatchUpdates,
  shouldReuseRunningNx,
} from '../services/mcDesignNxRuntime.js'

let tmpDir: string | undefined
let originalFetch: typeof globalThis.fetch | undefined

afterEach(async () => {
  if (originalFetch) {
    globalThis.fetch = originalFetch
    originalFetch = undefined
  }
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('mc-design NX runtime helpers', () => {
  it('resolves wrapped nx_* names to real plugin tool names', () => {
    expect(resolveNxToolName('nx_test')).toBe('Test')
    expect(resolveNxToolName('nx_get_work_part_info')).toBe('GetWorkPartInfo')
    expect(resolveNxToolName('nx_get_optimization_tool_guide')).toBe('GetOptimizationToolGuide')
    expect(resolveNxToolName('nx_validate_optimization_study')).toBe('ValidateOptimizationStudy')
    expect(resolveNxToolName('nx_build_optimization_objective_expression')).toBe('BuildOptimizationObjectiveExpression')
    expect(resolveNxToolName('nx_run_optimization_study')).toBe('RunOptimizationStudy')
    expect(resolveNxToolName('GetDriveParamsList')).toBe('GetDriveParamsList')
  })

  it('flags write/open/export NX tools for confirmation', () => {
    expect(isNxWriteTool('nx_batch_update_params')).toBe(true)
    expect(isNxWriteTool('nx_open_part')).toBe(true)
    expect(isNxWriteTool('nx_get_work_part_info')).toBe(false)
    expect(isNxWriteTool('nx_get_optimization_tool_guide')).toBe(false)
    expect(isNxWriteTool('nx_validate_optimization_study')).toBe(false)
    expect(isNxWriteTool('nx_build_optimization_objective_expression')).toBe(true)
    expect(isNxWriteTool('nx_run_optimization_study')).toBe(true)
  })

  it('reuses a running NX process even when a part path is requested', () => {
    const running = [{ pid: 123, name: 'ugraf.exe' }]

    expect(shouldReuseRunningNx(running, {
      partPath: 'F:\\workspace\\template.prt',
    })).toBe(true)
    expect(shouldReuseRunningNx(running, {
      partPath: 'F:\\workspace\\template.prt',
      reuseRunning: false,
    })).toBe(false)
  })

  it('maps calculated parameter ids to real NX drive expressions', () => {
    const mappings = mapNxParametersToExpressions(
      {
        CR_A_CEN: 155.7,
        CR_B_DIA: 62,
        CR_UNKNOWN: 1,
      },
      {
        result: {
          data: {
            expressions: [
              { std_id: 'CR_A_CEN', equation: 'CR_A_CEN=215' },
              { std_id: '连杆大头直径', equation: 'CR_B_DIA=85' },
            ],
          },
        },
      },
    )

    expect(mappings).toContainEqual(expect.objectContaining({
      paramId: 'CR_A_CEN',
      matched: true,
      currentValue: '215',
    }))
    expect(mappings).toContainEqual(expect.objectContaining({
      paramId: 'CR_B_DIA',
      matched: true,
      currentValue: '85',
    }))
    expect(mappings).toContainEqual(expect.objectContaining({
      paramId: 'CR_UNKNOWN',
      matched: false,
    }))
  })

  it('builds same-value batch updates from matched expressions', () => {
    const updates = sameValueBatchUpdates([
      { paramId: 'CR_A_CEN', targetValue: 155.7, currentValue: '215', matched: true },
      { paramId: 'CR_B_DIA', targetValue: 62, currentValue: '85', matched: true },
      { paramId: 'CR_UNKNOWN', targetValue: 1, matched: false },
    ])

    expect(updates).toEqual([
      { std_id: 'CR_A_CEN', value: '215' },
      { std_id: 'CR_B_DIA', value: '85' },
    ])
  })

  it('filters isolated anonymous p-number expressions while preserving related ones', () => {
    const filtered = filterNxExpressions({
      result: {
        data: {
          expressions: [
            { std_id: 'CR_A_CEN', equation: 'CR_A_CEN=215' },
            { std_id: 'p105', equation: 'p105=CR_S_T/2+2' },
            { std_id: 'p999', equation: 'p999=42' },
          ],
        },
      },
    })

    expect(filtered.expressions).toContainEqual(expect.objectContaining({
      std_id: 'CR_A_CEN',
    }))
    expect(filtered.expressions).toContainEqual(expect.objectContaining({
      std_id: 'p105',
      uncertainty: 'anonymous_expression_related_to_standard_parameters',
      relatedStandardParams: ['CR_S_T'],
    }))
    expect(filtered.filteredOut).toContainEqual(expect.objectContaining({
      std_id: 'p999',
      filterReason: 'isolated_anonymous_expression',
    }))
  })

  it('checks NX plugin health through the configured base URL', async () => {
    originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      const payload = String(input).endsWith('/tools')
        ? { ok: true, data: { tools: [] } }
        : { ok: true, data: 'heartbeat' }
      return new Response(JSON.stringify(payload), { status: 200 })
    }) as typeof globalThis.fetch

    const status = await getNxPluginStatus({
      baseUrl: 'http://127.0.0.1:18088/api',
    })

    expect(status.ok).toBe(true)
    expect(requestedUrls).toEqual([
      'http://127.0.0.1:18088/api/health',
      'http://127.0.0.1:18088/api/tools',
    ])
  })

  it('calls an NX plugin tool using the original plugin endpoint name', async () => {
    originalFetch = globalThis.fetch
    let body = ''
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body ?? '')
      return new Response(JSON.stringify({ ok: true, data: { passed: true } }), {
        status: 200,
      })
    }) as typeof globalThis.fetch

    const result = await callNxPluginTool(
      'nx_test',
      { sample: true },
      { baseUrl: 'http://127.0.0.1:18088/api' },
    )

    expect(result.ok).toBe(true)
    expect(result.originalTool).toBe('Test')
    expect(JSON.parse(body)).toEqual({ sample: true })
  })

  it('allows slow NX write tools to finish instead of aborting at the read timeout', async () => {
    originalFetch = globalThis.fetch
    let signal: AbortSignal | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal | undefined
      await new Promise(resolve => setTimeout(resolve, 25))
      return new Response(JSON.stringify({ ok: true, data: { updated: true } }), {
        status: 200,
      })
    }) as typeof globalThis.fetch

    const result = await callNxPluginTool(
      'nx_batch_update_params',
      { expressions: [{ std_id: 'CS_M_DIA', value: '119' }] },
      { baseUrl: 'http://127.0.0.1:18088/api' },
    )

    expect(signal?.aborted).toBe(false)
    expect(result.ok).toBe(true)
    expect(result.originalTool).toBe('BatchUpdateParams')
  })

  it('blocks Objective_AI from being reused as an optimization input objective', async () => {
    originalFetch = globalThis.fetch
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof globalThis.fetch

    const result = await callNxPluginTool(
      'nx_run_optimization_study',
      {
        variables: [{ name: 'CR_R_W', lower: '18', upper: '25' }],
        objectives: [{ name: 'Objective_AI', objective_type: '最小化' }],
      },
      { baseUrl: 'http://127.0.0.1:18088/api' },
    )

    expect(called).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.originalTool).toBe('RunOptimizationStudy')
    expect(result.error).toBe('invalid_optimization_objective')
    expect(String(result.message)).toContain('不能作为 objective 再传入')
  })

  it('reports NX plugin request timeouts without surfacing abort wording', async () => {
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined
      await new Promise((_resolve, reject) => {
        if (!signal) {
          reject(new Error('missing signal'))
          return
        }
        signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    }) as typeof globalThis.fetch

    const result = await callNxPluginTool(
      'nx_batch_update_params',
      { expressions: [{ std_id: 'CS_M_DIA', value: '119' }] },
      { baseUrl: 'http://127.0.0.1:18088/api', writeTimeoutMs: 1000 },
    )

    expect(result.ok).toBe(false)
    expect(result.timeout_ms).toBe(1000)
    expect(String(result.error)).toContain('timed out after 1000ms')
    expect(String(result.error)).not.toContain('aborted')
  })

  it('discovers a Siemens NX install from an explicit root', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-nx-'))
    const nxRoot = path.join(tmpDir, 'NX 11.0')
    const nxbin = path.join(nxRoot, 'NXBIN')
    await fs.mkdir(nxbin, { recursive: true })
    await fs.writeFile(path.join(nxbin, 'ugraf.exe'), '')

    const installations = await discoverNxInstallations({
      extraRoots: [tmpDir],
      referenceRoot: path.join(tmpDir, 'missing-history'),
    })

    expect(installations).toContainEqual(expect.objectContaining({
      executablePath: path.join(nxbin, 'ugraf.exe'),
    }))
  })

  it('registers the project NX plugin path into NX custom_dirs.dat with a backup', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-nx-plugin-'))
    const nxRoot = path.join(tmpDir, 'NX 11.0')
    const nxbin = path.join(nxRoot, 'NXBIN')
    const menus = path.join(nxRoot, 'UGII', 'menus')
    const customFile = path.join(menus, 'custom_dirs.dat')
    await fs.mkdir(nxbin, { recursive: true })
    await fs.mkdir(menus, { recursive: true })
    await fs.writeFile(path.join(nxbin, 'ugraf.exe'), '')

    const pluginDir = path.join(tmpDir, 'project-nx-plugin')
    for (const relativePath of [
      'startup/NXServer.dll',
      'startup/test_menu.men',
      'startup/test_rbn.rtb',
      'tools/NXTools.dll',
      'sdk/NXSDK.dll',
    ]) {
      const fullPath = path.join(pluginDir, relativePath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, relativePath)
    }

    await fs.writeFile(
      customFile,
      [
        'C:\\Existing\\Plugin',
        '# MC Design Client BEGIN',
        'E:\\Old\\mc-design\\client\\nx-plugin',
        '# MC Design Client END',
        '',
      ].join('\r\n'),
      'utf8',
    )

    const checkOnly = await prepareProjectNxPlugin({
      executablePath: path.join(nxbin, 'ugraf.exe'),
      pluginDir,
    })
    expect(checkOnly.ok).toBe(false)
    expect(checkOnly.error).toBe('NX_PLUGIN_REGISTRATION_REQUIRED')

    const registered = await prepareProjectNxPlugin({
      executablePath: path.join(nxbin, 'ugraf.exe'),
      pluginDir,
      write: true,
      confirmed: true,
    })
    expect(registered.ok).toBe(true)
    expect(registered.registered).toBe(true)
    expect(String(registered.backupPath)).toContain('custom_dirs.dat.beya-mc-design.')

    const text = await fs.readFile(customFile, 'utf8')
    expect(text).toContain('C:\\Existing\\Plugin')
    expect(text).toContain(pluginDir)
    expect(text).not.toContain('E:\\Old\\mc-design\\client\\nx-plugin')

    const alreadyRegistered = await prepareProjectNxPlugin({
      executablePath: path.join(nxbin, 'ugraf.exe'),
      pluginDir,
    })
    expect(alreadyRegistered.ok).toBe(true)
    expect(alreadyRegistered.mode).toBe('already_registered')
  })
})
