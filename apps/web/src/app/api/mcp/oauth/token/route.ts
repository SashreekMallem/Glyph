/**
 * OAuth 2.1 token endpoint.
 *
 * Exchanges a short-lived authorization code (issued by /authorize) for
 * an access token. The token IS a Glyph API key — we mint a fresh
 * `api_keys` row scoped to the user, named `oauth:<client_id>`, and
 * return its raw value. The MCP route validates it via the existing
 * `verifyApiKey` path, so no other auth code changes.
 *
 * PKCE verification: sha256(code_verifier) must equal the stored
 * code_challenge (S256). RFC 7636.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db";
import { apiKeys, oauthCodes } from "@/db/schema";
import { generateApiKey } from "@glyph/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenError(error: string, description?: string, status = 400) {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

function base64UrlSha256(input: string): string {
  return createHash("sha256")
    .update(input)
    .digest("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // RFC 6749 requires application/x-www-form-urlencoded; some clients
  // also send JSON. Accept both.
  let params: URLSearchParams;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text());
  } else if (ct.includes("application/json")) {
    try {
      const obj = (await req.json()) as Record<string, unknown>;
      params = new URLSearchParams();
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") params.set(k, v);
      }
    } catch {
      return tokenError("invalid_request", "Body must be form-encoded or JSON");
    }
  } else {
    // Last-ditch: try form parsing.
    try {
      params = new URLSearchParams(await req.text());
    } catch {
      return tokenError("invalid_request", "Unsupported content-type");
    }
  }

  const grantType = params.get("grant_type");
  if (grantType !== "authorization_code") {
    return tokenError("unsupported_grant_type");
  }

  const code = params.get("code");
  const redirectUri = params.get("redirect_uri");
  const clientId = params.get("client_id");
  const codeVerifier = params.get("code_verifier");

  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return tokenError("invalid_request", "Missing required parameters");
  }

  const now = new Date();
  const [row] = await db
    .select()
    .from(oauthCodes)
    .where(
      and(
        eq(oauthCodes.code, code),
        eq(oauthCodes.clientId, clientId),
        eq(oauthCodes.redirectUri, redirectUri),
        gt(oauthCodes.expiresAt, now),
        isNull(oauthCodes.consumedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return tokenError("invalid_grant", "Code expired, reused, or unknown");
  }

  // PKCE: S256 only.
  const expected = base64UrlSha256(codeVerifier);
  if (expected !== row.codeChallenge) {
    return tokenError("invalid_grant", "PKCE verification failed");
  }

  // Single-use: mark consumed first to prevent races.
  await db
    .update(oauthCodes)
    .set({ consumedAt: now })
    .where(eq(oauthCodes.id, row.id));

  // Mint the access token = a new API key for the authorizing user.
  const { raw, hash, prefix } = generateApiKey();
  await db.insert(apiKeys).values({
    userId: row.userId,
    name: `oauth:${clientId}`,
    keyHash: hash,
    keyPrefix: prefix,
  });

  return NextResponse.json(
    {
      access_token: raw,
      token_type: "Bearer",
      scope: row.scope ?? "mcp",
      // No refresh_token: MCP clients re-run the OAuth flow if the key
      // is ever revoked. Simpler than rotating refresh tokens.
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}
