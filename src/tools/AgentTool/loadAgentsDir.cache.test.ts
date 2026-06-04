import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  getAllowedSettingSources,
  getCwdState,
  setAllowedSettingSources,
  setCwdState,
} from '../../bootstrap/state.js'
import { resetSyncCache } from '../../services/remoteManagedSettings/syncCacheState.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import {
  getProjectDirsUpToHome,
  loadMarkdownFilesForSubdir,
} from '../../utils/markdownConfigLoader.js'
import { resetRipgrepConfigCache } from '../../utils/ripgrep.js'
import {
  getManagedFilePath,
  getManagedSettingsDropInDir,
} from '../../utils/settings/managedPath.js'
import { clearMdmSettingsCache } from '../../utils/settings/mdm/settings.js'
import { isRestrictedToPluginOnly } from '../../utils/settings/pluginOnlyPolicy.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import type { SettingSource } from '../../utils/settings/constants.js'
import { agentsHandler } from '../../cli/handlers/agents.js'
import { formatAgentAsMarkdown } from '../../components/agents/agentFileUtils.js'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
} from './loadAgentsDir.js'

let tmpHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalClaudeConfigDir: string | undefined
let originalClaudeCodeSimple: string | undefined
let originalManagedSettingsPath: string | undefined
let originalUserType: string | undefined
let originalAllowedSettingSources: SettingSource[]
let originalCwdState: string

function clearSettingsState(): void {
  resetSettingsCache()
  resetSyncCache()
  clearMdmSettingsCache()
  resetRipgrepConfigCache()
  ;(
    getManagedFilePath as typeof getManagedFilePath & {
      cache?: { clear?: () => void }
    }
  ).cache?.clear?.()
  ;(
    getManagedSettingsDropInDir as typeof getManagedSettingsDropInDir & {
      cache?: { clear?: () => void }
    }
  ).cache?.clear?.()
}

function isolateAgentLookupState(projectRoot: string): void {
  setCwdState(projectRoot)
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
  process.env.USER_TYPE = 'external'
  setAllowedSettingSources([
    'userSettings',
    'projectSettings',
    'localSettings',
  ])
  clearSettingsState()
}

describe('agent definition cache invalidation', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-def-cache-'))
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalClaudeConfigDir = process.env.BEYA_CONFIG_DIR
    originalClaudeCodeSimple = process.env.CLAUDE_CODE_SIMPLE
    originalManagedSettingsPath = process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
    originalUserType = process.env.USER_TYPE
    originalAllowedSettingSources = getAllowedSettingSources()
    originalCwdState = getCwdState()

    clearSettingsState()
    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    process.env.BEYA_CONFIG_DIR = path.join(tmpHome, '.beya')
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
    process.env.USER_TYPE = 'external'
    setAllowedSettingSources([
      'userSettings',
      'projectSettings',
      'localSettings',
    ])
    clearSettingsState()
    clearAgentDefinitionsCache()
  })

  afterEach(async () => {
    clearSettingsState()
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

    if (originalClaudeConfigDir === undefined) {
      delete process.env.BEYA_CONFIG_DIR
    } else {
      process.env.BEYA_CONFIG_DIR = originalClaudeConfigDir
    }

    if (originalClaudeCodeSimple === undefined) {
      delete process.env.CLAUDE_CODE_SIMPLE
    } else {
      process.env.CLAUDE_CODE_SIMPLE = originalClaudeCodeSimple
    }

    if (originalManagedSettingsPath === undefined) {
      delete process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
    } else {
      process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH = originalManagedSettingsPath
    }

    if (originalUserType === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = originalUserType
    }

    setCwdState(originalCwdState)
    setAllowedSettingSources(originalAllowedSettingSources)
    clearSettingsState()
    clearAgentDefinitionsCache()
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  test('shows a newly-created project agent in the /agents output after clearing the cached read', async () => {
    const projectRoot = path.join(tmpHome, 'project')
    await fs.mkdir(projectRoot, { recursive: true })
    isolateAgentLookupState(projectRoot)

    const agentType = 'cache-created-agent'
    await runWithCwdOverride(projectRoot, async () => {
      isolateAgentLookupState(projectRoot)
      const before = await getAgentDefinitionsWithOverrides(projectRoot)

      expect(before.allAgents.some(agent => agent.agentType === agentType)).toBe(
        false,
      )

      const agentFilePath = path.join(
        projectRoot,
        '.beya',
        'agents',
        `${agentType}.md`,
      )
      await fs.mkdir(path.dirname(agentFilePath), { recursive: true })
      await fs.writeFile(
        agentFilePath,
        formatAgentAsMarkdown(
          agentType,
          'Use this agent to verify cache invalidation.',
          undefined,
          'You verify cache invalidation.',
        ),
      )

      await expect(fs.stat(agentFilePath)).resolves.toBeDefined()

      const cachedAfterWrite = await getAgentDefinitionsWithOverrides(
        projectRoot,
      )
      expect(
        cachedAfterWrite.allAgents.some(agent => agent.agentType === agentType),
      ).toBe(false)

      isolateAgentLookupState(projectRoot)
      clearAgentDefinitionsCache()
      expect(getAllowedSettingSources()).toContain('projectSettings')
      expect(process.env.CLAUDE_CODE_SIMPLE).toBeUndefined()
      expect(isRestrictedToPluginOnly('agents')).toBe(false)
      expect(getProjectDirsUpToHome('agents', projectRoot)).toContain(
        path.dirname(agentFilePath),
      )
      const markdownFiles = await loadMarkdownFilesForSubdir(
        'agents',
        projectRoot,
      )
      expect(markdownFiles.map(file => file.filePath)).toContain(agentFilePath)
      const after = await getAgentDefinitionsWithOverrides(projectRoot)

      expect(after.allAgents).toContainEqual(
        expect.objectContaining({
          agentType,
          source: 'projectSettings',
        }),
      )

      const logs: string[] = []
      const originalLog = console.log
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      }
      try {
        isolateAgentLookupState(projectRoot)
        await agentsHandler()
      } finally {
        console.log = originalLog
      }

      expect(logs.join('\n')).toContain(agentType)
    })
  })
})
