import { describe, expect, it } from 'bun:test'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { getTools } from '../tools.js'

describe('tool registry ESM runtime', () => {
  it('loads the default tool surface without CommonJS require', () => {
    expect(() => getTools(getEmptyToolPermissionContext())).not.toThrow()

    const toolNames = getTools(getEmptyToolPermissionContext()).map(
      tool => tool.name,
    )

    expect(toolNames).toContain('Skill')
  })
})
