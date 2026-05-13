/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 *
 * MCP clients (claude.ai, ChatGPT, etc.) fetch this first when they
 * discover an OAuth-protected MCP server. It points them at our
 * authorization server's metadata document.
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deriveOrigin(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return new URL(req.url).origin;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = deriveOrigin(req);
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
