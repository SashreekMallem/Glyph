import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  structureTool,
  structureHandler,
  type StructureDeps,
} from './tools/structure.js';
import { validateTool, validateHandler, type ValidateDeps } from './tools/validate.js';
import { generateTool, generateHandler, type GenerateDeps } from './tools/generate.js';
import { readPayloadTool, readPayloadHandler } from './tools/readPayload.js';
import {
  discoverSchemaTool,
  discoverSchemaHandler,
  type DiscoverSchemaDeps,
} from './tools/discoverSchema.js';
import {
  proposeSchemaBlockTool,
  proposeSchemaBlockHandler,
  type ProposeSchemaBlockDeps,
} from './tools/proposeSchemaBlock.js';

export interface CreateServerDeps
  extends GenerateDeps,
    StructureDeps,
    ValidateDeps,
    DiscoverSchemaDeps,
    ProposeSchemaBlockDeps {
  readonly glyphApiUrl: string;
  /**
   * Bearer token used to authorize sub-requests to /api/v1/*. When set
   * (HTTPS/SSE transport, after the route authenticates the caller),
   * tools authorize automatically and don't need the AI to pass `api_key`
   * as an argument. When unset (stdio transport), the AI must still
   * provide `api_key` in the tool args.
   */
  readonly bearerToken?: string;
}

/**
 * Returns the static tool list. Exported separately so tests can assert
 * registration without driving the SDK transport.
 */
export function listTools() {
  return [
    structureTool,
    validateTool,
    generateTool,
    readPayloadTool,
    discoverSchemaTool,
    proposeSchemaBlockTool,
  ];
}

export async function dispatchToolCall(
  name: string,
  args: unknown,
  deps: CreateServerDeps,
) {
  // When the HTTPS transport already authenticated the caller, inject the
  // bearer token into args so tool handlers can authorize sub-requests
  // without the AI having to pass `api_key`. AI-provided `api_key` (stdio
  // path) still wins if present.
  const argsWithAuth =
    deps.bearerToken && args && typeof args === 'object' && !Array.isArray(args)
      ? { api_key: deps.bearerToken, ...(args as Record<string, unknown>) }
      : args;

  switch (name) {
    case 'structure_document':
      return structureHandler(argsWithAuth, {
        glyphApiUrl: deps.glyphApiUrl,
        fetch: deps.fetch,
      });
    case 'validate_document':
      return validateHandler(argsWithAuth, { glyphApiUrl: deps.glyphApiUrl, fetch: deps.fetch });
    case 'generate_structured_document':
      return generateHandler(argsWithAuth, deps);
    case 'read_glyph_payload':
      return readPayloadHandler(argsWithAuth, {
        fetch: deps.fetch,
        glyphApiUrl: deps.glyphApiUrl,
      });
    case 'discover_schema':
      return discoverSchemaHandler(argsWithAuth, {
        glyphApiUrl: deps.glyphApiUrl,
        fetch: deps.fetch,
      });
    case 'propose_schema_block':
      return proposeSchemaBlockHandler(argsWithAuth, {
        glyphApiUrl: deps.glyphApiUrl,
        fetch: deps.fetch,
      });
    default:
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      };
  }
}

export function createServer(deps: CreateServerDeps): Server {
  const server = new Server(
    { name: 'glyph-mcp', version: '0.3.0' },
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
