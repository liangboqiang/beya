import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import { clearInstalledPluginsCache } from '../../utils/plugins/installedPluginsManager.js'
import { clearPluginCache } from '../../utils/plugins/pluginLoader.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { handleServerTools } from '../api/tools.js'

let tmpHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalBeyaConfigDir: string | undefined
let originalCwdState: string

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-design-desktop-'))
  originalHome = process.env.HOME
  originalUserProfile = process.env.USERPROFILE
  originalBeyaConfigDir = process.env.BEYA_CONFIG_DIR
  originalCwdState = getCwdState()

  process.env.HOME = tmpHome
  process.env.USERPROFILE = tmpHome
  process.env.BEYA_CONFIG_DIR = path.join(tmpHome, '.beya')
  setCwdState(tmpHome)
  clearInstalledPluginsCache()
  clearPluginCache('mc-design-desktop-test-setup')
  resetSettingsCache()
})

afterEach(async () => {
  clearInstalledPluginsCache()
  clearPluginCache('mc-design-desktop-test-teardown')
  resetSettingsCache()
  restoreEnv('HOME', originalHome)
  restoreEnv('USERPROFILE', originalUserProfile)
  restoreEnv('BEYA_CONFIG_DIR', originalBeyaConfigDir)
  setCwdState(originalCwdState)
  await fs.rm(tmpHome, { recursive: true, force: true })
})

describe('mc-design desktop runtime tool surface', () => {
  it('lists and executes the local design-agent tools through /api/tools', async () => {
    const listResponse = await handleServerTools(
      ...requestParts('GET', `/api/tools?cwd=${encodeURIComponent(tmpHome)}`),
    )
    expect(listResponse.status).toBe(200)
    const body = await listResponse.json() as {
      tools: Array<{ name: string; executable?: boolean; plugin?: boolean }>
    }
    const names = body.tools.map(tool => tool.name)
    expect(names).toContain('mc_design_recommend_templates')
    expect(names).toContain('mc_design_plan_workflow')
    expect(names).toContain('mc_design_prepare_template_workspace')
    expect(names).toContain('mc_design_nx_call_tool')
    expect(names).not.toContain('mc_design_optimize_parameters')
    expect(names).toContain('mc_design_filter_nx_expressions')
    expect(names).toContain('mc_design_generate_report_artifacts')
    expect(names).toContain('mc_design_generate_conrod_drawing')

    const recommendation = await executeTool('mc_design_recommend_templates', {
      task_id: 'ECS-CRANK-001',
      limit: 2,
    })
    expect(recommendation.ok).toBe(true)
    expect(recommendation.algorithm).toBe('weighted_normalized_euclidean_similarity')
    expect(recommendation.best_template_id).toBe('TC-TPL-CRANK-B')
    expect(recommendation.bestTemplateId).toBeUndefined()

    const report = await executeTool('mc_design_generate_report_artifacts', {
      confirmed: true,
      allow_confirmed_missing_images: true,
      include_dfmea: false,
      task_id: 'ECS-CRANK-001',
      template_id: recommendation.best_template_id,
      parameters: { CS_Q_RAD: 62.5, CS_M_DIA: 88 },
    })
    expect(report.ok).toBe(true)
    expect(report.report_format).toBe('docx')
    expect(report.reportFormat).toBeUndefined()
    expect(String(report.report_path)).toContain(tmpHome)
    expect(String(report.report_path)).toMatch(/\.docx$/)
    await expect(fs.stat(String(report.report_path))).resolves.toEqual(
      expect.objectContaining({ size: expect.any(Number) }),
    )
  })
})

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await handleServerTools(
    ...requestParts(
      'POST',
      `/api/tools/${toolName}/execute?cwd=${encodeURIComponent(tmpHome)}`,
      {
        input,
        permission_mode: 'bypassPermissions',
        run_id: `mc-design-${toolName}`,
        session_id: `mc-design-${toolName}`,
      },
    ),
  )
  expect(response.status).toBe(200)
  const body = await response.json() as {
    result?: { content?: unknown; is_error?: boolean }
  }
  expect(body.result?.is_error).not.toBe(true)
  return parseToolTextPayload(body.result?.content)
}

function parseToolTextPayload(content: unknown): Record<string, unknown> {
  if (typeof content === 'string') {
    return JSON.parse(content) as Record<string, unknown>
  }
  if (Array.isArray(content)) {
    const block = content.find(item =>
      item && typeof item === 'object' && (item as { type?: unknown }).type === 'text')
    if (block && typeof block === 'object') {
      return JSON.parse(String((block as { text?: unknown }).text ?? '{}')) as Record<string, unknown>
    }
  }
  throw new Error(`Unexpected tool content: ${JSON.stringify(content)}`)
}

function requestParts(
  method: string,
  urlStr: string,
  body?: unknown,
): [Request, URL, string[]] {
  const url = new URL(urlStr, 'http://localhost:3456')
  const req = new Request(url.toString(), {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return [req, url, url.pathname.split('/').filter(Boolean)]
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
