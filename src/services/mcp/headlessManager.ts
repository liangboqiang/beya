import type { Command } from '../../types/command.js'
import type { Tool } from '../../Tool.js'
import {
  clearServerCache,
  getMcpToolsCommandsAndResources,
} from './client.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'

export type HeadlessMcpSnapshot = {
  clients: MCPServerConnection[]
  tools: Tool[]
  commands: Command[]
  resources: Record<string, ServerResource[]>
}

export async function connectHeadlessMcpServers(
  mcpConfigs?: Record<string, ScopedMcpServerConfig>,
): Promise<HeadlessMcpSnapshot> {
  const clientsByName = new Map<string, MCPServerConnection>()
  const toolsByServerPrefix = new Map<string, Tool[]>()
  const commandsByServerPrefix = new Map<string, Command[]>()
  const resources: Record<string, ServerResource[]> = {}

  await getMcpToolsCommandsAndResources(
    ({ client, tools, commands, resources: serverResources }) => {
      clientsByName.set(client.name, client)
      const prefix = `mcp__${client.name}__`
      toolsByServerPrefix.set(prefix, tools)
      commandsByServerPrefix.set(prefix, commands)
      if (serverResources) {
        resources[client.name] = serverResources
      }
    },
    mcpConfigs,
  )

  return {
    clients: [...clientsByName.values()],
    tools: [...toolsByServerPrefix.values()].flat(),
    commands: [...commandsByServerPrefix.values()].flat(),
    resources,
  }
}

export async function disconnectHeadlessMcpServers(
  clients: readonly MCPServerConnection[],
): Promise<void> {
  await Promise.all(
    clients.map(async client => {
      if (client.type === 'connected') {
        await client.cleanup().catch(() => {})
      }
      await clearServerCache(client.name, client.config).catch(() => {})
    }),
  )
}
