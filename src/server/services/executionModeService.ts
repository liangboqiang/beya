import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { SettingsService } from './settingsService.js'

export type ExecutionMode = 'provider' | 'local_cli'

export const EXECUTION_MODE_SETTINGS_KEY = 'executionMode'

export function normalizeExecutionMode(value: unknown): ExecutionMode {
  return value === 'local_cli' ? 'local_cli' : 'provider'
}

export async function getExecutionMode(
  settingsService = new SettingsService(),
): Promise<ExecutionMode> {
  const settings = await settingsService.getUserSettings()
  return normalizeExecutionMode(settings[EXECUTION_MODE_SETTINGS_KEY])
}

export function resolveExecutionModeSync(
  options: {
    configDir?: string
  } = {},
): ExecutionMode {
  const configDir = options.configDir ?? process.env.BEYA_CONFIG_DIR ?? path.join(os.homedir(), '.beya')
  const settingsPath = path.join(configDir, 'settings.json')

  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    return normalizeExecutionMode(raw[EXECUTION_MODE_SETTINGS_KEY])
  } catch {
    return 'provider'
  }
}
