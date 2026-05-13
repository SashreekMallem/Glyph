/**
 * POST /api/v1/schema-blocks/propose
 *
 * Accepts a schema-block proposal from a Glyph API-key holder (typically
 * an MCP-connected AI working in a domain the core library doesn't cover
 * yet). The proposal lands in `schema_block_proposals` with status
 * "pending" — Glyph reviewers approve/merge offline.
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { apiKeys, schemaBlockProposals } from "@/db/schema";
import { verifyApiKey } from "@glyph/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY_PREFIX_LEN = 16;

const BodySchema = z.object({
  domain: z.string().min(1).max(64),
  proposed_name: z.string().min(1).max(80),
  proposed_json_schema: z.record(z.string(), z.unknown()),
  rationale: z.string().max(500).optional(),
});

function err(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m?.[1] ?? null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Auth
    const raw = parseBearer(req.headers.get("authorization"));
    if (!raw || raw.length < API_KEY_PREFIX_LEN) {
      return err(401, "unauthorized", "Missing or malformed Bearer token.");
    }
    const keyPrefix = raw.slice(0, API_KEY_PREFIX_LEN);
    const [keyRecord] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, keyPrefix))
      .limit(1);
    if (!keyRecord) return err(401, "unauthorized", "Invalid API key.");
    const ok = await verifyApiKey(raw, keyRecord.keyHash);
    if (!ok) return err(401, "unauthorized", "Invalid API key.");
    if (!keyRecord.isActive)
      return err(403, "revoked", "API key has been revoked.");

    // Parse body
    let parsed: z.infer<typeof BodySchema>;
    try {
      const body = await req.json();
      const result = BodySchema.safeParse(body);
      if (!result.success) {
        return err(400, "bad_request", "Body validation failed.", {
          issues: result.error.issues,
        });
      }
      parsed = result.data;
    } catch {
      return err(400, "bad_request", "Body is not valid JSON.");
    }

    // Sanity-check the proposed schema. It must declare type:"object" and
    // have at least one property — anything else is almost certainly an
    // invented or malformed proposal.
    const schema = parsed.proposed_json_schema as Record<string, unknown>;
    if (schema.type !== "object") {
      return err(
        422,
        "invalid_schema",
        'proposed_json_schema must have type: "object".',
      );
    }
    const props = schema.properties as Record<string, unknown> | undefined;
    if (
      !props ||
      typeof props !== "object" ||
      Object.keys(props).length === 0
    ) {
      return err(
        422,
        "invalid_schema",
        "proposed_json_schema must declare a non-empty `properties` object.",
      );
    }

    // Insert proposal
    const [row] = await db
      .insert(schemaBlockProposals)
      .values({
        domain: parsed.domain,
        proposedName: parsed.proposed_name,
        proposedJsonSchema: parsed.proposed_json_schema,
        rationale: parsed.rationale ?? null,
        proposedByUserId: keyRecord.userId,
        status: "pending",
      })
      .returning();

    if (!row) {
      return err(500, "internal_error", "Insert returned no row.");
    }

    return NextResponse.json(
      {
        proposal_id: row.id,
        status: row.status,
        domain: row.domain,
        message:
          "Proposal submitted; pending review. Re-run discover_schema in 24 hours to see if it was approved.",
      },
      { status: 201 },
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[schema-blocks/propose] error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return err(500, "internal_error", "Request failed.");
  }
}

function methodNotAllowed(): NextResponse {
  return err(405, "method_not_allowed", "POST only.");
}
export async function GET(): Promise<NextResponse> {
  return methodNotAllowed();
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
