import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'sdk-mcp-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'lookup_design',
    description: 'Lookup a design context from the MCP fixture server',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
    },
  }],
}))

server.setRequestHandler(CallToolRequestSchema, async request => ({
  content: [{
    type: 'text',
    text: `mcp:${String(request.params.arguments?.id ?? '')}`,
  }],
}))

await server.connect(new StdioServerTransport())
