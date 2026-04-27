# @glyph/mcp-server

Model Context Protocol (MCP) server for Glyph. Exposes three tools that let
any MCP-compatible AI assistant (Claude Desktop, Claude Code, Cursor, etc.)
author structured documents that round-trip through Glyph's validation and
signing pipeline.

## Tools

### `structure_document`
Convert raw text into a validated structured JSON payload for a given
`document_type` (contract / resume / invoice). Uses the shared heuristic
extractor in `@glyph/mcp-server/extractor` and the Zod schemas from
`@glyph/schema-library`.

**Input**
```json
{
  "document_type": "contract" | "resume" | "invoice",
  "raw_text": "..."
}
```

**Output** — validated JSON matching the schema, or `isError: true` with a
machine-readable error list.

### `validate_document`
Validates an already-structured payload against a schema version. Returns
`{ "valid": true }` or `{ "valid": false, "errors": [{ path, message }] }`.

### `generate_structured_document`
Submits a validated payload to Glyph's API (`POST /api/mcp/generate`) using
the caller's `sk_live_*` / `sk_test_*` API key, which triggers encryption,
signing, rendering, and upload. Returns a signed `download_url`.

**Input**
```json
{
  "document_type": "contract",
  "structured_data": { ... },
  "output_format": "pdf" | "docx" | "gdocs",
  "api_key": "sk_live_...",
  "title": "Optional title"
}
```

## Transport

Runs over HTTP (see `src/server.ts` → `createServer`). The public Glyph
API route (`/api/mcp/*`) authenticates every request with the shared header
`x-glyph-mcp-secret` (see `src/auth.ts`) — it is *not* the user's API key.
The user's API key travels inside the `generate_structured_document` tool
arguments and is forwarded as `Authorization: Bearer <key>` to
`/api/mcp/generate`.

## Rate limiting

`InMemoryTokenBucketLimiter` in `src/rateLimit.ts` provides per-key token
buckets with refill. For multi-instance deployments, replace with a Redis
limiter implementing the same `check(key)` interface.

## Development

```bash
pnpm -F @glyph/mcp-server typecheck
pnpm -F @glyph/mcp-server test
pnpm -F @glyph/mcp-server build
```

## Environment

| Var | Purpose |
| --- | --- |
| `MCP_SERVER_SECRET` | Shared secret the HTTP route checks via `x-glyph-mcp-secret`. |
| `GLYPH_API_URL` | Base URL of the Glyph API (e.g. `https://app.glyph.dev`). |

## Claude Desktop config

```json
{
  "mcpServers": {
    "glyph": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-server/dist/bin.js"],
      "env": {
        "GLYPH_API_URL": "https://app.glyph.dev",
        "MCP_SERVER_SECRET": "..."
      }
    }
  }
}
```
