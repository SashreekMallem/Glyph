/**
 * POST /api/gdocs/validate
 *
 * Input: { documentType: DocumentType, text: string }
 * Output: { extracted, errors, valid }
 *
 * Runs the shared heuristic extractor against the plaintext body pulled
 * from a Google Doc, then verifies the result against the canonical zod
 * schema. Auth: Bearer API key (same mechanism as /api/v1/extract) — Apps
 * Script's UrlFetchApp cannot carry browser cookies.
 */

import { NextResponse, type NextRequest } from "next/server";

import { type DocumentType } from "@glyph/schema-library";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { extractHeuristic } from "@/lib/extract/heuristic";
import { isBuiltInType, resolveSchema } from "@/server/documentRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ValidateInput {
  readonly documentType: string;
  readonly text: string;
  readonly blockIds?: readonly string[];
}

function err(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

function isValidateInput(v: unknown): v is ValidateInput {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.documentType === "string" && typeof o.text === "string";
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
  if (!isValidateInput(body)) {
    return err(400, "bad_request", "Body must contain documentType and text.");
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

  const errors: Array<{ path: string; message: string }> = result.missingFields.map(
    (f) => ({ path: f, message: `${f} is missing or could not be extracted.` }),
  );
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        path: issue.path.join("."),
        message: issue.message,
      });
    }
  }

  return NextResponse.json(
    {
      extracted: result.extracted,
      errors,
      valid: errors.length === 0,
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
