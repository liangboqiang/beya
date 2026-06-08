import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const nxToolsSourceRoot = path.join(
  process.cwd(),
  'runtime',
  'mc-design',
  'dependencies',
  'nx-plugin',
  'src',
  'McDesign.NXTools',
)
const nxResourcesRoot = path.join(
  process.cwd(),
  'runtime',
  'mc-design',
  'dependencies',
  'resources',
)

describe('mc-design NX plugin source contract', () => {
  it('removes drawing automation tools from source compilation and manifest', async () => {
    await expect(fs.stat(
      path.join(nxToolsSourceRoot, 'AutoDrawingTools.cs'),
    )).rejects.toThrow()

    const csproj = await fs.readFile(
      path.join(nxToolsSourceRoot, 'McDesign.NXTools.csproj'),
      'utf8',
    )
    expect(csproj).not.toContain('AutoDrawingTools.cs')

    const manifest = JSON.parse(await fs.readFile(
      path.join(nxResourcesRoot, 'nx_tools_manifest.json'),
      'utf8',
    )) as { tools: Array<Record<string, unknown>> }
    for (const tool of manifest.tools) {
      const serialized = JSON.stringify(tool).toLowerCase().replace(/_/g, '')
      expect(tool.category).not.toBe('AutoDrawing')
      expect(serialized).not.toContain('autodrawing')
      expect(serialized).not.toContain('runautodrawing')
      expect(serialized).not.toContain('createautodrawing')
      expect(serialized).not.toContain('validateautodrawing')
    }
  })

  it('keeps NX optimization tools exposed through ToolAttribute', async () => {
    const source = await fs.readFile(
      path.join(nxToolsSourceRoot, 'OptimizationTools.cs'),
      'utf8',
    )

    for (const toolName of [
      'GetOptimizationToolGuide',
      'ValidateOptimizationStudy',
      'BuildOptimizationObjectiveExpression',
      'RunOptimizationStudy',
    ]) {
      expect(source).toContain(`[Tool("${toolName}"`)
    }
  })

  it('accepts numeric or string values for batch expression updates', async () => {
    const source = await fs.readFile(
      path.join(nxToolsSourceRoot, 'ExpressionTools.cs'),
      'utf8',
    )

    expect(source).toContain('public object value { get; set; }')
    expect(source).toContain('NormalizeNumberString(Convert.ToString(it.value, CultureInfo.InvariantCulture))')
  })

  it('does not expose camshaft create-new modeling tools', async () => {
    const files = ['CamshaftTools.cs', 'CamshaftDesignTools.cs']
    for (const file of files) {
      const source = await fs.readFile(path.join(nxToolsSourceRoot, file), 'utf8')
      expect(source).not.toMatch(/\[Tool\(/)
    }
  })
})
