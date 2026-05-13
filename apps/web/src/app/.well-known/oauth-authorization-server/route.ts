/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
 *
 * Advertises our authorize / token / register endpoints to MCP clients
 * after they follow the link from /.well-known/oauth-protected-resource.
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = new URL(req.url).origin;
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
      token_endpoint: `${origin}/api/mcp/oauth/token`,
      registration_endpoint: `${origin}/api/mcp/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
