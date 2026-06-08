import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import { clearInstalledPluginsCache } from '../../utils/plugins/installedPluginsManager.js'
import { clearPluginCache } from '../../utils/plugins/pluginLoader.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { handlePluginsApi } from '../api/plugins.js'
import { handleServerTools } from '../api/tools.js'

let tmpHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalBeyaConfigDir: string | undefined
let originalCwdState: string

function makeRequest(
  method: string,
  urlStr: string,
  body?: unknown,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const req = new Request(url.toString(), {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

describe('Tools API', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'beya-tools-test-'))
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalBeyaConfigDir = process.env.BEYA_CONFIG_DIR
    originalCwdState = getCwdState()

    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    process.env.BEYA_CONFIG_DIR = path.join(tmpHome, '.beya')
    setCwdState(tmpHome)
    clearInstalledPluginsCache()
    clearPluginCache('tools-api-test-setup')
    resetSettingsCache()
  })

  afterEach(async () => {
    clearInstalledPluginsCache()
    clearPluginCache('tools-api-test-teardown')
    resetSettingsCache()
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = originalUserProfile
    }
    if (originalBeyaConfigDir === undefined) {
      delete process.env.BEYA_CONFIG_DIR
    } else {
      process.env.BEYA_CONFIG_DIR = originalBeyaConfigDir
    }
    setCwdState(originalCwdState)
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  it('lists Desktop/CLI native tools and SDK-installed plugin tools from one runtime surface', async () => {
    const install = makeRequest('POST', '/api/plugins', {
      type: 'inline',
      scope: 'user',
      definition: {
        name: 'sdk-tools-demo',
        description: 'SDK installed tools',
        tools: [
          {
            name: 'remote_echo',
            description: 'Remote echo tool',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string' } },
            },
            annotations: { readOnlyHint: true },
            executor: {
              type: 'http',
              url: 'http://127.0.0.1:8765/tools',
              method: 'POST',
            },
          },
        ],
      },
    })
    const installRes = await handlePluginsApi(install.req, install.url, install.segments)
    expect(installRes.status).toBe(200)

    const request = makeRequest('GET', `/api/tools?cwd=${encodeURIComponent(tmpHome)}`)
    const response = await handleServerTools(request.req, request.url, request.segments)

    expect(response.status).toBe(200)
    const body = await response.json() as {
      tools: Array<{
        name: string
        native?: boolean
        plugin?: boolean
        requires_user_interaction?: boolean
      }>
    }
    expect(body.tools).toContainEqual(expect.objectContaining({
      name: 'Skill',
      native: true,
      plugin: false,
    }))
    expect(body.tools).toContainEqual(expect.objectContaining({
      name: 'AskUserQuestion',
      native: true,
      requires_user_interaction: true,
    }))
    expect(body.tools).toContainEqual(expect.objectContaining({
      name: 'remote_echo',
      native: false,
      plugin: true,
    }))
    expect(body.tools).toContainEqual(expect.objectContaining({
      name: 'mc_design_query_tasks',
      native: false,
      plugin: true,
      executable: true,
    }))
    expect(body.tools).toContainEqual(expect.objectContaining({
      name: 'mc_design_find_nx',
      native: false,
      plugin: true,
      executable: true,
    }))
    expect(body.tools).toContainEqual(expect.objectContaining({
      name: 'mc_design_prepare_nx_plugin',
      native: false,
      plugin: true,
      executable: true,
    }))
    expect(body.tools).toContainEqual(expect.objectContaining({
      name: 'mc_design_list_local_assets',
      native: false,
      plugin: true,
      executable: true,
    }))
    expect(body.tools).toContainEqual(expect.objectContaining({
      name: 'mc_design_run_local_chain_check',
      native: false,
      plugin: true,
      executable: true,
    }))
  })

  it('executes workspace skills through the same native Skill tool surface', async () => {
    const skillDir = path.join(tmpHome, '.beya', 'skills', 'design-report')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: design-report
description: Generate a concise design report from available design information.
---

# Design Report

Use this skill to prepare a concise design report. Return sections for inputs, calculation basis, risks, and next actions.
`,
      'utf8',
    )
    setCwdState(originalCwdState)

    const request = makeRequest(
      'POST',
      `/api/tools/Skill/execute?cwd=${encodeURIComponent(tmpHome)}`,
      {
        input: { skill: 'design-report' },
        permission_mode: 'bypassPermissions',
        run_id: 'skill-execute-test',
        session_id: 'skill-execute-test',
      },
    )
    const response = await Promise.race([
      handleServerTools(request.req, request.url, request.segments),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error('Skill execute timed out')), 10_000),
      ),
    ])

    expect(response.status).toBe(200)
    const body = await response.json() as {
      result?: { is_error?: boolean; content?: unknown }
    }
    expect(JSON.stringify(body)).not.toContain('require is not defined')
    expect(body.result?.is_error).not.toBe(true)
  })
})
