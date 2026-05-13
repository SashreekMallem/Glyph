/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 *
 * MCP clients (claude.ai, ChatGPT, etc.) fetch this first when they
 * discover an OAuth-protected MCP server. It points them at our
 * authorization server's metadata document.
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = new URL(req.url).origin;
  return NextResponse.json(
    {
      resource: `${origin}/api/mcp/v1`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
      resource_documentation: `${origin}/`,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
