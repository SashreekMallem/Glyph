/**
 * POST /api/gdocs/finalize
 *
 * Input: { documentType: DocumentType, text: string, googleDocId: string }
 * Output: { encrypted, iv, tag, signature, schemaVersion, documentType }
 *
 * Also records a finalized document row and a document_exports row keyed
 * by the Google Doc fileId so we can reconcile future edits.
 */

import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { documents, documentExports } from "@/db/schema";
import {
  encryptPayload,
  signPayload,
} from "@glyph/crypto";
import { getSchema, type DocumentType } from "@glyph/schema-library";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { extractHeuristic } from "@/lib/extract/heuristic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_TYPES: readonly DocumentType[] = [
  "contract",
  "resume",
  "invoice",
];

interface FinalizeInput {
  readonly documentType: string;
  readonly text: string;
  readonly googleDocId: string;
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
  if (!(SUPPORTED_TYPES as readonly string[]).includes(body.documentType)) {
    return err(400, "bad_request", `Unsupported documentType: ${body.documentType}`);
  }

  const docType = body.documentType as DocumentType;
  const result = extractHeuristic(docType, body.text);

  const schema = getSchema(docType);
  const parsed = schema.safeParse(result.extracted);
  if (!parsed.success) {
    return err(400, "validation_failed", "Heuristic extract does not match schema.", {
      issues: parsed.error.issues,
      missingFields: result.missingFields,
    });
  }

  const data = parsed.data as Record<string, unknown>;
  const schemaVersion =
    typeof data.schema_version === "string" ? data.schema_version : "1.0";

  const encrypted = await encryptPayload(data);
  const signature = await signPayload(encrypted.encrypted);

  // Best-effort persistence — failure must not break client embedding.
  try {
    const title = `GDoc ${body.googleDocId}`;
    const [docRow] = await db
      .insert(documents)
      .values({
        userId: auth.key.userId,
        title,
        documentType: docType,
        documentTypeKey: docType,
        schemaVersion,
        validatedJson: data,
        encryptedPayload: encrypted.encrypted,
        payloadIv: encrypted.iv,
        payloadTag: encrypted.tag,
        payloadSignature: signature,
        isFinalized: true,
      })
      .returning({ id: documents.id });

    if (docRow !== undefined) {
      await db.insert(documentExports).values({
        documentId: docRow.id,
        userId: auth.key.userId,
        format: "gdocs",
        gdocsFileId: body.googleDocId,
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[gdocs/finalize] persistence error", {
      message: e instanceof Error ? e.message : "unknown",
    });
  }

  return NextResponse.json(
    {
      encrypted: encrypted.encrypted,
      iv: encrypted.iv,
      tag: encrypted.tag,
      signature,
      schemaVersion,
      documentType: docType,
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
