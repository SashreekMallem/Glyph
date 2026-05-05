/**
 * POST /api/gdocs/finalize
 *
 * First-time finalize for Google Docs documents. Validates, canonicalizes,
 * attaches `_meta` (signed fingerprints + regions), encrypts, and signs —
 * returns the encrypted blob for the add-on to write into Drive
 * appProperties.
 *
 * On every subsequent open/save the add-on should call `syncDocument()`
 * (Apps Script wrapper around `/api/v1/sync`) instead. That path detects
 * field-level drift and refreshes the embedded payload field-by-field —
 * no full re-extraction needed.
 *
 * Input: { documentType, text, googleDocId, blockIds?, regions? }
 * Output: { encrypted, iv, tag, signature, schemaVersion, documentType, ... }
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  encryptPayload,
  signPayload,
} from "@glyph/crypto";
import { type DocumentType } from "@glyph/schema-library";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { extractHeuristic } from "@/lib/extract/heuristic";
import { attachMeta, buildMeta } from "@/lib/payload-meta";
import { isBuiltInType, resolveSchema } from "@/server/documentRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FinalizeInput {
  readonly documentType: string;
  readonly text: string;
  readonly googleDocId: string;
  readonly blockIds?: readonly string[];
  readonly regions?: Record<string, [number, number]>;
}

function err(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

function isFinalizeInput(v: unknown): v is FinalizeInput {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.documentType === "string" &&
    typeof o.text === "string" &&
    typeof o.googleDocId === "string" &&
    o.googleDocId.length > 0
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth.ok) {
    return err(auth.status, auth.code, auth.message);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err(400, "bad_request", "Body is not valid JSON.");
  }
  if (!isFinalizeInput(body)) {
    return err(
      400,
      "bad_request",
      "Body must contain documentType, text, googleDocId.",
    );
  }

  let resolved: Awaited<ReturnType<typeof resolveSchema>>;
  try {
    resolved = await resolveSchema({
      documentType: body.documentType,
      blockIds: body.blockIds,
      userId: auth.key.userId,
    });
  } catch {
    return err(400, "bad_request", `Unsupported documentType: ${body.documentType}`);
  }

  const result = isBuiltInType(body.documentType)
    ? extractHeuristic(body.documentType as DocumentType, body.text)
    : {
        extracted: { raw_text: body.text } as Record<string, unknown>,
        missingFields: [] as string[],
      };

  const parsed = resolved.zod.safeParse(result.extracted);
  if (!parsed.success) {
    return err(400, "validation_failed", "Heuristic extract does not match schema.", {
      issues: parsed.error.issues,
      missingFields: result.missingFields,
    });
  }

  const data = parsed.data as Record<string, unknown>;
  const schemaVersion =
    typeof data.schema_version === "string" ? data.schema_version : "1.0";

  const meta = buildMeta({
    sourceText: body.text,
    regions: body.regions ?? {},
    schemaVersion,
    blockIds: resolved.blockIds ?? null,
    compositionId: resolved.compositionId ?? null,
  });
  const withMeta = attachMeta(data, meta);

  const encrypted = await encryptPayload(withMeta);
  const signature = await signPayload(encrypted.encrypted);

  // No DB persistence: the Google Doc's Document Properties hold the
  // encrypted payload. Keeping plaintext validated JSON in Postgres would
  // be a data-leak surface for no benefit.

  return NextResponse.json(
    {
      encrypted: encrypted.encrypted,
      iv: encrypted.iv,
      tag: encrypted.tag,
      signature,
      schemaVersion,
      documentType: body.documentType,
      compositionId: resolved.compositionId,
      blockIds: resolved.blockIds,
    },
    { status: 200 },
  );
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
