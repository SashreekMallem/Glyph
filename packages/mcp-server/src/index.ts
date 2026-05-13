/**
 * Public surface of @glyph/mcp-server.
 *
 * Two import surfaces:
 *
 *   - `listTools` / `dispatchToolCall` / `CreateServerDeps` come from
 *     `./dispatcher`, which contains ZERO references to the
 *     `@modelcontextprotocol/sdk`. Safe to import from edge / serverless
 *     bundles (our HTTPS/SSE transport at apps/web/src/app/api/mcp/v1
 *     uses this path).
 *
 *   - `createServer` comes from `./server`, which DOES import the SDK
 *     (it's the stdio transport). Only the stdio CLI loads this path.
 *
 * Splitting the two prevents the SDK's ESM-only transitive deps from
 * being dragged into the Vercel function bundle, which was crashing
 * the function on module load.
 */

export { listTools, dispatchToolCall } from "./dispatcher.js";
export type { CreateServerDeps } from "./dispatcher.js";
export { createServer } from "./server.js";

export {
  structureTool,
  structureHandler,
} from "./tools/structure.js";
export { validateTool, validateHandler } from "./tools/validate.js";
export { generateTool, generateHandler } from "./tools/generate.js";
export { readPayloadTool, readPayloadHandler } from "./tools/readPayload.js";
export type { ToolResult } from "./tools/structure.js";
export type { GenerateDeps } from "./tools/generate.js";
export type { ReadPayloadDeps } from "./tools/readPayload.js";
export { extractHeuristic } from "./extractor.js";
