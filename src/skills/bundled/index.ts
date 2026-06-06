import { feature } from 'bun:bundle'
import { shouldAutoEnableClaudeInChrome } from 'src/utils/claudeInChrome/setup.js'
import { registerBatchSkill } from './batch.js'
import { registerClaudeApiSkill } from './claudeApi.js'
import { registerClaudeInChromeSkill } from './claudeInChrome.js'
import { registerDebugSkill } from './debug.js'
import { registerKeybindingsSkill } from './keybindings.js'
import { registerLoopSkill } from './loop.js'
import { registerLoremIpsumSkill } from './loremIpsum.js'
import { registerRememberSkill } from './remember.js'
import { registerScheduleRemoteAgentsSkill } from './scheduleRemoteAgents.js'
import { registerSimplifySkill } from './simplify.js'
import { registerSkillifySkill } from './skillify.js'
import { registerStuckSkill } from './stuck.js'
import { registerUpdateConfigSkill } from './updateConfig.js'
import { registerVerifySkill } from './verify.js'

/**
 * Initialize all bundled skills.
 * Called at startup to register skills that ship with the CLI.
 *
 * Keep this file ESM-only. It runs inside the packaged beya-server executable,
 * where CommonJS require is not available.
 */
export function initBundledSkills(): void {
  registerUpdateConfigSkill()
  registerKeybindingsSkill()
  registerVerifySkill()
  registerDebugSkill()
  registerLoremIpsumSkill()
  registerSkillifySkill()
  registerRememberSkill()
  registerSimplifySkill()
  registerBatchSkill()
  registerStuckSkill()

  if (feature('KAIROS') || feature('KAIROS_DREAM')) {
    void import('./dream.js').then(module => {
      const register = (module as Record<string, unknown>).registerDreamSkill
      if (typeof register === 'function') register()
    })
  }
  if (feature('REVIEW_ARTIFACT')) {
    void import('./hunter.js').then(module => {
      const register = (module as Record<string, unknown>).registerHunterSkill
      if (typeof register === 'function') register()
    })
  }
  if (feature('AGENT_TRIGGERS')) {
    registerLoopSkill()
  }
  if (feature('AGENT_TRIGGERS_REMOTE')) {
    registerScheduleRemoteAgentsSkill()
  }
  if (feature('BUILDING_CLAUDE_APPS')) {
    registerClaudeApiSkill()
  }
  if (shouldAutoEnableClaudeInChrome()) {
    registerClaudeInChromeSkill()
  }
  if (feature('RUN_SKILL_GENERATOR')) {
    void import('./runSkillGenerator.js').then(module => {
      const register = (module as Record<string, unknown>)
        .registerRunSkillGeneratorSkill
      if (typeof register === 'function') register()
    })
  }
}
