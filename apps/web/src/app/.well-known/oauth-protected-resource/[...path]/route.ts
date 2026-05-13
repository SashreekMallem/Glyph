/**
 * RFC 9728 path-suffixed variant.
 *
 * claude.ai probes /.well-known/oauth-protected-resource/<server-path>
 * (e.g. /.well-known/oauth-protected-resource/api/mcp/v1) when the MCP
 * server isn't at the host root. We serve the same metadata document at
 * every suffix so discovery works regardless of how the client probes.
 *
 * The `resource` field is set to the actual MCP server URL the path
 * refers to so claude.ai's strict equality check passes.
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const origin = deriveOrigin(req);
  const { path } = await params;
  const subpath = "/" + (path?.join("/") ?? "");
  return NextResponse.json(
    {
      resource: `${origin}${subpath}`,
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
