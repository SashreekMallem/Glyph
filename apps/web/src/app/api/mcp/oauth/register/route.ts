/**
 * RFC 7591 — OAuth 2.0 Dynamic Client Registration.
 *
 * Claude.ai / ChatGPT / Perplexity POST their client metadata here on
 * first connection. We mint a client_id, store the metadata, and return
 * it. Public clients use PKCE → no client_secret is issued.
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

import { db } from "@/db";
import { oauthClients } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RegisterRequest {
  client_name?: unknown;
  redirect_uris?: unknown;
  grant_types?: unknown;
  token_endpoint_auth_method?: unknown;
  scope?: unknown;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RegisterRequest;
  try {
    body = (await req.json()) as RegisterRequest;
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Body must be JSON" },
      { status: 400 },
    );
  }

  if (!isStringArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return NextResponse.json(
      {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris must be a non-empty array of strings",
      },
      { status: 400 },
    );
  }

  const clientName =
    typeof body.client_name === "string" && body.client_name.length > 0
      ? body.client_name.slice(0, 200)
      : "Unnamed MCP client";

  const grantTypes = isStringArray(body.grant_types)
    ? body.grant_types
    : ["authorization_code", "refresh_token"];

  const tokenEndpointAuthMethod =
    typeof body.token_endpoint_auth_method === "string"
      ? body.token_endpoint_auth_method
      : "none";

  // Public-client registration: PKCE-only, no secret issued.
  const clientId = `mcp_${randomBytes(16).toString("hex")}`;

  await db.insert(oauthClients).values({
    clientId,
    clientName,
    redirectUris: body.redirect_uris,
    grantTypes,
    tokenEndpointAuthMethod,
  });

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: body.redirect_uris,
      grant_types: grantTypes,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      // Required by some clients; we never expire client registrations.
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201 },
  );
}
