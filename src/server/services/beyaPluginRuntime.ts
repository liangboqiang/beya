import { basename, resolve } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { createSkillCommand } from '../../skills/loadSkillsDir.js'
import type { Command } from '../../types/command.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import {
  McpServerConfigSchema,
  type ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import { loadPluginMcpServers } from '../../utils/plugins/mcpPluginIntegration.js'
import { createPluginFromPath, loadAllPlugins } from '../../utils/plugins/pluginLoader.js'
import { loadSkillsFromDirectory } from '../../utils/plugins/loadPluginCommands.js'
import type {
  PluginDefinition,
  PluginRef,
  SkillDefinition,
  ToolDefinition,
} from '../types/serverRuntime.js'

export type LoadedBeyaPlugin = {
  name: string
  path: string
  tools: ToolDefinition[]
  commands: Command[]
  mcpServers: Record<string, ScopedMcpServerConfig>
  loadedPlugin?: LoadedPlugin
  errors: unknown[]
}

export async function loadBeyaPlugins(
  plugins: PluginRef[] = [],
): Promise<LoadedBeyaPlugin[]> {
  return Promise.all(plugins.map(loadBeyaPlugin))
}

export async function loadInstalledBeyaPlugins(): Promise<LoadedBeyaPlugin[]> {
  const { enabled, errors } = await loadAllPlugins()
  return Promise.all(
    enabled.map(plugin => loadedPluginToBeyaPlugin(
      plugin,
      filterPluginErrors(errors, plugin),
    )),
  )
}

function filterPluginErrors(
  errors: PluginError[],
  plugin: LoadedPlugin,
): PluginError[] {
  return errors.filter(error => pluginErrorMatches(error, plugin))
}

function pluginErrorMatches(error: PluginError, plugin: LoadedPlugin): boolean {
  if (error.source === plugin.source) return true
  if ('plugin' in error && error.plugin === plugin.name) return true
  return error.source.startsWith(`${plugin.name}@`)
}

const registeredBeyaPlugins = new Map<string, PluginRef>()

export async function listRegisteredBeyaPlugins(): Promise<{
  plugins: Array<{
    id: string
    name: string
    path: string
    tools: number
    commands: number
    mcpServers: number
    errors: string[]
  }>
}> {
  const plugins = await Promise.all(
    Array.from(registeredBeyaPlugins.entries()).map(
      async ([id, ref]) => summarizeRegisteredBeyaPlugin(id, ref),
    ),
  )
  return { plugins }
}

export async function getRegisteredBeyaPlugin(id: string): Promise<{
  plugin: Awaited<ReturnType<typeof summarizeRegisteredBeyaPlugin>>
}> {
  const ref = registeredBeyaPlugins.get(id)
  if (!ref) throw new Error(`Plugin not found: ${id}`)
  return { plugin: await summarizeRegisteredBeyaPlugin(id, ref) }
}

export async function registerBeyaPlugin(
  ref: PluginRef,
  id = defaultPluginId(ref),
): Promise<{
  plugin: Awaited<ReturnType<typeof summarizeRegisteredBeyaPlugin>>
}> {
  const loaded = await loadBeyaPlugins([ref])
  const errors = loaded.flatMap(plugin => plugin.errors)
  if (errors.length > 0) {
    throw new Error(
      `Failed to load Beya plugin ${id}: ${errors.map(String).join('; ')}`,
    )
  }
  registeredBeyaPlugins.set(id, ref)
  return { plugin: await summarizeRegisteredBeyaPlugin(id, ref) }
}

export function unregisterBeyaPlugin(id: string): boolean {
  return registeredBeyaPlugins.delete(id)
}

export async function reloadRegisteredBeyaPlugins(): Promise<{
  plugins: Awaited<ReturnType<typeof listRegisteredBeyaPlugins>>['plugins']
  reloaded: true
}> {
  const { plugins } = await listRegisteredBeyaPlugins()
  return { plugins, reloaded: true }
}

export async function listRegisteredBeyaSkills(): Promise<{
  skills: Array<{
    name: string
    description: string
    source: string
    plugin: string
    allowedTools?: string[]
  }>
}> {
  const loaded = await Promise.all(
    Array.from(registeredBeyaPlugins.values()).map(ref => loadBeyaPlugins([ref])),
  )
  return {
    skills: loaded
      .flat()
      .flatMap(plugin =>
        plugin.commands.map(command => ({
          name: command.name,
          description: command.description,
          source: 'plugin',
          plugin: plugin.name,
          allowedTools:
            command.type === 'prompt' ? command.allowedTools : undefined,
        })),
      ),
  }
}

export async function getRegisteredBeyaSkill(name: string): Promise<{
  skill: Awaited<ReturnType<typeof listRegisteredBeyaSkills>>['skills'][number]
}> {
  const { skills } = await listRegisteredBeyaSkills()
  const skill = skills.find(candidate => candidate.name === name)
  if (!skill) throw new Error(`Skill not found: ${name}`)
  return { skill }
}

export function inlineSkillToCommand(
  skill: SkillDefinition,
  pluginName = 'beya-server',
): Command {
  const skillName = skill.name.includes(':')
    ? skill.name
    : `${pluginName}:${skill.name}`

  return createSkillCommand({
    skillName,
    displayName: skill.name,
    description: skill.description,
    hasUserSpecifiedDescription: true,
    markdownContent: skill.content,
    allowedTools: skill.allowedTools ?? [],
    argumentHint: skill.argumentHint,
    argumentNames: [],
    whenToUse: skill.whenToUse,
    version: undefined,
    model: skill.model,
    disableModelInvocation: false,
    userInvocable: skill.userInvocable ?? true,
    source: 'plugin',
    baseDir: undefined,
    loadedFrom: 'plugin',
    hooks: undefined,
    executionContext: undefined,
    agent: undefined,
    paths: undefined,
    effort: undefined,
    shell: undefined,
  })
}

async function loadBeyaPlugin(plugin: PluginRef): Promise<LoadedBeyaPlugin> {
  if (typeof plugin === 'object' && plugin.type === 'inline') {
    const definition = plugin.definition
    return {
      name: definition.name,
      path: '<inline>',
      tools: definition.tools ?? [],
      commands: (definition.skills ?? [])
        .filter(isInlineSkill)
        .map(skill => inlineSkillToCommand(skill, definition.name)),
      mcpServers: scopedInlineMcpServers(definition),
      errors: [],
    }
  }

  const pluginPath = resolve(
    typeof plugin === 'string' ? plugin : plugin.path,
  )
  const { plugin: loadedPlugin, errors } = await createPluginFromPath(
    pluginPath,
    'server',
    true,
    basename(pluginPath),
  )
  return loadedPluginToBeyaPlugin(loadedPlugin, errors)
}

async function loadedPluginToBeyaPlugin(
  loadedPlugin: LoadedPlugin,
  errors: unknown[] = [],
): Promise<LoadedBeyaPlugin> {
  return {
    name: loadedPlugin.name,
    path: loadedPlugin.path,
    loadedPlugin,
    tools: await loadLoadedPluginTools(loadedPlugin),
    commands: await loadLoadedPluginSkills(loadedPlugin),
    mcpServers: await loadLoadedPluginMcpServers(loadedPlugin),
    errors,
  }
}

export async function loadLoadedPluginTools(
  plugin: LoadedPlugin,
): Promise<ToolDefinition[]> {
  const toolRoots = await existingToolRoots(plugin)
  const nested = await Promise.all(toolRoots.map(loadToolDefinitionsFromRoot))
  return nested.flat()
}

async function existingToolRoots(plugin: LoadedPlugin): Promise<string[]> {
  const candidates = [
    resolve(plugin.path, 'tools'),
    ...manifestToolPaths(plugin),
  ]
  const seen = new Set<string>()
  const existing: string[] = []
  for (const candidate of candidates) {
    const resolved = resolve(candidate)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    try {
      if ((await stat(resolved)).isDirectory()) {
        existing.push(resolved)
      }
    } catch {
      // Missing tool directories are allowed; plugin schema still owns validation.
    }
  }
  return existing
}

function manifestToolPaths(plugin: LoadedPlugin): string[] {
  const tools = (plugin.manifest as { tools?: unknown }).tools
  if (typeof tools === 'string') return [resolve(plugin.path, tools)]
  if (Array.isArray(tools)) {
    return tools
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => resolve(plugin.path, entry))
  }
  return []
}

async function loadToolDefinitionsFromRoot(root: string): Promise<ToolDefinition[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const tools = await Promise.all(entries.map(async entry => {
    const candidate = entry.isDirectory()
      ? resolve(root, entry.name, 'tool.json')
      : entry.name.endsWith('.json')
        ? resolve(root, entry.name)
        : ''
    if (!candidate) return null
    try {
      const parsed = JSON.parse(await readFile(candidate, 'utf-8')) as unknown
      return isToolDefinition(parsed) ? parsed : null
    } catch {
      return null
    }
  }))
  return tools.filter((tool): tool is ToolDefinition => tool !== null)
}

function isToolDefinition(value: unknown): value is ToolDefinition {
  if (!value || typeof value !== 'object') return false
  const tool = value as ToolDefinition
  return typeof tool.name === 'string' &&
    tool.name.trim().length > 0 &&
    typeof tool.description === 'string' &&
    tool.description.trim().length > 0
}

async function loadLoadedPluginSkills(
  plugin: LoadedPlugin,
): Promise<Command[]> {
  const loadedPaths = new Set<string>()
  const skillPaths = [
    ...(plugin.skillsPath ? [plugin.skillsPath] : []),
    ...(plugin.skillsPaths ?? []),
  ]
  const nested = await Promise.all(
    skillPaths.map(skillPath =>
      loadSkillsFromDirectory(
        skillPath,
        plugin.name,
        plugin.source,
        plugin.manifest,
        plugin.path,
        loadedPaths,
      ),
    ),
  )
  return nested.flat()
}

async function loadLoadedPluginMcpServers(
  plugin: LoadedPlugin,
): Promise<Record<string, ScopedMcpServerConfig>> {
  const errors: unknown[] = []
  const servers = plugin.mcpServers ?? await loadPluginMcpServers(plugin, errors)
  if (!servers) return {}
  return Object.fromEntries(
    Object.entries(servers).map(([name, config]) => [
      name,
      {
        ...config,
        scope: 'dynamic' as const,
        pluginSource: plugin.source,
      },
    ]),
  )
}

function scopedInlineMcpServers(
  definition: PluginDefinition,
): Record<string, ScopedMcpServerConfig> {
  const spec = definition.mcpServers
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return {}
  const scoped: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(spec)) {
    const parsed = McpServerConfigSchema().safeParse(config)
    if (!parsed.success) {
      throw new Error(
        `Invalid inline MCP server config for ${definition.name}:${name}`,
      )
    }
    scoped[name] = {
      ...parsed.data,
      scope: 'dynamic',
      pluginSource: definition.name,
    }
  }
  return scoped
}

function isInlineSkill(skill: string | SkillDefinition): skill is SkillDefinition {
  return typeof skill === 'object' && skill !== null
}

async function summarizeRegisteredBeyaPlugin(id: string, ref: PluginRef) {
  const [loaded] = await loadBeyaPlugins([ref])
  if (!loaded) {
    return {
      id,
      name: id,
      path: '<unknown>',
      tools: 0,
      commands: 0,
      mcpServers: 0,
      errors: ['Plugin did not load'],
    }
  }
  return {
    id,
    name: loaded.name,
    path: loaded.path,
    tools: loaded.tools.length,
    commands: loaded.commands.length,
    mcpServers: Object.keys(loaded.mcpServers).length,
    errors: loaded.errors.map(String),
  }
}

function defaultPluginId(ref: PluginRef): string {
  if (typeof ref === 'string') return basename(ref)
  if (ref.type === 'inline') return ref.definition.name
  return basename(ref.path)
}
