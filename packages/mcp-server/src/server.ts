import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { structureTool, structureHandler } from './tools/structure.js';
import { validateTool, validateHandler } from './tools/validate.js';
import { generateTool, generateHandler, type GenerateDeps } from './tools/generate.js';

export interface CreateServerDeps extends GenerateDeps {
  readonly glyphApiUrl: string;
}

/**
 * Returns the static tool list. Exported separately so tests can assert
 * registration without driving the SDK transport.
 */
export function listTools() {
  return [structureTool, validateTool, generateTool];
}

export async function dispatchToolCall(
  name: string,
  args: unknown,
  deps: CreateServerDeps,
) {
  switch (name) {
    case 'structure_document':
      return structureHandler(args);
    case 'validate_document':
      return validateHandler(args);
    case 'generate_structured_document':
      return generateHandler(args, deps);
    default:
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      };
  }
}

export function createServer(deps: CreateServerDeps): Server {
  const server = new Server(
    { name: 'glyph', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await dispatchToolCall(
      req.params.name,
      req.params.arguments,
      deps,
    );
    // MCP SDK's CallToolResult is a wider union; our ToolResult shape is
    // structurally compatible with the "content + isError" variant.
    return result as unknown as {
      content: Array<{ type: 'text'; text: string }>;
      isError?: boolean;
    };
  });

  return server;
}
