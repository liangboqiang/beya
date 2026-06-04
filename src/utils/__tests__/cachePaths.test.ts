import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { CACHE_PATHS } from '../cachePaths.js'

const originalClaudeConfigDir = process.env.BEYA_CONFIG_DIR

afterEach(() => {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.BEYA_CONFIG_DIR
  } else {
    process.env.BEYA_CONFIG_DIR = originalClaudeConfigDir
  }
})

describe('CACHE_PATHS portable mode', () => {
  test('places logs under BEYA_CONFIG_DIR when portable mode is active', () => {
    const configDir = join(tmpdir(), 'beya-portable-cache')
    process.env.BEYA_CONFIG_DIR = configDir

    expect(CACHE_PATHS.baseLogs().startsWith(join(configDir, 'Cache'))).toBe(true)
    expect(CACHE_PATHS.errors().startsWith(join(configDir, 'Cache'))).toBe(true)
    expect(CACHE_PATHS.messages().startsWith(join(configDir, 'Cache'))).toBe(true)
    expect(CACHE_PATHS.mcpLogs('test:server').startsWith(join(configDir, 'Cache'))).toBe(true)
  })
})
