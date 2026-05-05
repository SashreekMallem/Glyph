import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { verifyApiKey } from "@glyph/crypto";
import { listBlocksForDomain } from "@/server/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY_PREFIX_LEN = 16;

function err(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m?.[1] ?? null;
}

async function authenticate(req: NextRequest): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  const raw = parseBearer(req.headers.get("authorization"));
  if (!raw || raw.length < API_KEY_PREFIX_LEN) {
    return {
      ok: false,
      response: err(401, "unauthorized", "Missing or malformed Bearer token."),
    };
  }
  const keyPrefix = raw.slice(0, API_KEY_PREFIX_LEN);
  const [keyRecord] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, keyPrefix))
    .limit(1);
  if (!keyRecord) {
    return { ok: false, response: err(401, "unauthorized", "Invalid API key.") };
  }
  const valid = await verifyApiKey(raw, keyRecord.keyHash);
  if (!valid) {
    return { ok: false, response: err(401, "unauthorized", "Invalid API key.") };
  }
  if (!keyRecord.isActive) {
    return {
      ok: false,
      response: err(403, "revoked", "API key has been revoked."),
    };
  }
  return { ok: true };
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain || domain.trim().length === 0) {
    return err(400, "bad_request", "Missing required `domain` query parameter.");
  }

  try {
    const blocks = await listBlocksForDomain(domain.trim());
    return NextResponse.json({ blocks }, { status: 200 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[v1/blocks] error", {
      domain,
      message: e instanceof Error ? e.message : String(e),
    });
    return err(500, "internal_error", "Failed to load blocks.");
  }
}

// Accept both POST (used by the MCP discover_schema tool) and GET for
// convenience. Both require Bearer auth and a `domain` query param.
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

function methodNotAllowed(): NextResponse {
  return err(405, "method_not_allowed", "GET or POST only.");
}
export async function PUT(): Promise<NextResponse> {
  return methodNotAllowed();
}
export async function DELETE(): Promise<NextResponse> {
  return methodNotAllowed();
}
export async function PATCH(): Promise<NextResponse> {
  return methodNotAllowed();
}
