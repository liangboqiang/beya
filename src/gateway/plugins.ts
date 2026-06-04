import { basename, resolve } from 'path'
import { createSkillCommand } from '../skills/loadSkillsDir.js'
import type { Command } from '../types/command.js'
import type { LoadedPlugin } from '../types/plugin.js'
import {
  McpServerConfigSchema,
  type ScopedMcpServerConfig,
} from '../services/mcp/types.js'
import { loadPluginMcpServers } from '../utils/plugins/mcpPluginIntegration.js'
import { createPluginFromPath } from '../utils/plugins/pluginLoader.js'
import { loadSkillsFromDirectory } from '../utils/plugins/loadPluginCommands.js'
import type {
  PluginDefinition,
  PluginRef,
  SkillDefinition,
  ToolDefinition,
} from './types.js'

export type LoadedGatewayPlugin = {
  name: string
  path: string
  tools: ToolDefinition[]
  commands: Command[]
  mcpServers: Record<string, ScopedMcpServerConfig>
  loadedPlugin?: LoadedPlugin
  errors: unknown[]
}

export async function loadGatewayPlugins(
  plugins: PluginRef[] = [],
): Promise<LoadedGatewayPlugin[]> {
  return Promise.all(plugins.map(loadGatewayPlugin))
}

const registeredGatewayPlugins = new Map<string, PluginRef>()

export async function listRegisteredGatewayPlugins(): Promise<{
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
    Array.from(registeredGatewayPlugins.entries()).map(
      async ([id, ref]) => summarizeRegisteredGatewayPlugin(id, ref),
    ),
  )
  return { plugins }
}

export async function getRegisteredGatewayPlugin(id: string): Promise<{
  plugin: Awaited<ReturnType<typeof summarizeRegisteredGatewayPlugin>>
}> {
  const ref = registeredGatewayPlugins.get(id)
  if (!ref) throw new Error(`Plugin not found: ${id}`)
  return { plugin: await summarizeRegisteredGatewayPlugin(id, ref) }
}

export async function registerGatewayPlugin(
  ref: PluginRef,
  id = defaultPluginId(ref),
): Promise<{
  plugin: Awaited<ReturnType<typeof summarizeRegisteredGatewayPlugin>>
}> {
  const loaded = await loadGatewayPlugins([ref])
  const errors = loaded.flatMap(plugin => plugin.errors)
  if (errors.length > 0) {
    throw new Error(
      `Failed to load Gateway plugin ${id}: ${errors.map(String).join('; ')}`,
    )
  }
  registeredGatewayPlugins.set(id, ref)
  return { plugin: await summarizeRegisteredGatewayPlugin(id, ref) }
}

export function unregisterGatewayPlugin(id: string): boolean {
  return registeredGatewayPlugins.delete(id)
}

export async function reloadRegisteredGatewayPlugins(): Promise<{
  plugins: Awaited<ReturnType<typeof listRegisteredGatewayPlugins>>['plugins']
  reloaded: true
}> {
  const { plugins } = await listRegisteredGatewayPlugins()
  return { plugins, reloaded: true }
}

export async function listRegisteredGatewaySkills(): Promise<{
  skills: Array<{
    name: string
    description: string
    source: string
    plugin: string
    allowedTools?: string[]
  }>
}> {
  const loaded = await Promise.all(
    Array.from(registeredGatewayPlugins.values()).map(ref => loadGatewayPlugins([ref])),
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

export async function getRegisteredGatewaySkill(name: string): Promise<{
  skill: Awaited<ReturnType<typeof listRegisteredGatewaySkills>>['skills'][number]
}> {
  const { skills } = await listRegisteredGatewaySkills()
  const skill = skills.find(candidate => candidate.name === name)
  if (!skill) throw new Error(`Skill not found: ${name}`)
  return { skill }
}

export function inlineSkillToCommand(
  skill: SkillDefinition,
  pluginName = 'gateway',
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

async function loadGatewayPlugin(plugin: PluginRef): Promise<LoadedGatewayPlugin> {
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
    'gateway',
    true,
    basename(pluginPath),
  )
  return {
    name: loadedPlugin.name,
    path: loadedPlugin.path,
    loadedPlugin,
    tools: [],
    commands: await loadLoadedPluginSkills(loadedPlugin),
    mcpServers: await loadLoadedPluginMcpServers(loadedPlugin),
    errors,
  }
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

async function summarizeRegisteredGatewayPlugin(id: string, ref: PluginRef) {
  const [loaded] = await loadGatewayPlugins([ref])
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
