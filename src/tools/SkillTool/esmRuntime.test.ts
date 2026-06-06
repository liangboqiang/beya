import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

const SKILL_RUNTIME_SURFACE = [
  'src/tools.ts',
  'src/tools/SkillTool/SkillTool.ts',
  'src/tools/SkillTool/prompt.ts',
  'src/tools/AgentTool/AgentTool.tsx',
  'src/tools/AgentTool/builtInAgents.ts',
  'src/tools/AgentTool/runAgent.ts',
  'src/services/tools/toolExecution.ts',
  'src/services/compact/postCompactCleanup.ts',
  'src/commands.ts',
  'src/constants/prompts.ts',
  'src/utils/api.ts',
  'src/utils/forkedAgent.ts',
  'src/utils/attachments.ts',
  'src/utils/permissions/permissions.ts',
  'src/utils/permissions/classifierDecision.ts',
  'src/utils/permissions/permissionSetup.ts',
  'src/utils/permissions/permissionRuleParser.ts',
  'src/utils/permissions/yoloClassifier.ts',
  'src/utils/plugins/cacheUtils.ts',
  'src/utils/promptShellExecution.ts',
  'src/query/stopHooks.ts',
  'src/skills/bundled/index.ts',
]

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('SkillTool ESM runtime surface', () => {
  it('does not use CommonJS require in the packaged session runtime path', () => {
    for (const file of SKILL_RUNTIME_SURFACE) {
      const source = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      expect(source, file).not.toMatch(/\beval\(['"]require['"]\)/)
      expect(source, file).not.toMatch(/\brequire\s*\(/)
    }
  })
})
