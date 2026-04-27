/**
 * POST /api/mcp/generate
 *
 * Endpoint invoked by the @glyph/mcp-server `generate_structured_document`
 * tool. Authenticates with a user's API key (`Authorization: Bearer
 * sk_live_...`), validates the payload against the schema for
 * `document_type`, encrypts + signs it, renders a PDF (docx/gdocs are not
 * yet supported server-side and return 501), uploads the artifact to the
 * private `exports` bucket, and returns a 1-hour signed URL.
 *
 * The MCP server's shared-secret header (`x-glyph-mcp-secret`) is NOT
 * required here — the caller authenticates with the user's API key
 * directly, which is the unit of authorization.
 */

import { NextResponse, type NextRequest } from "next/server";

import { encryptPayload, signPayload } from "@glyph/crypto";
import { getSchema, type GlyphDocument } from "@glyph/schema-library";

import { db } from "@/db";
import { documentExports, documents } from "@/db/schema";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { canonicalize } from "@/lib/canonicalize";
import { EXPORTS_BUCKET, getSupabaseServiceClient } from "@/lib/supabase/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerateBody {
  readonly document_type?: unknown;
  readonly structured_data?: unknown;
  readonly output_format?: unknown;
  readonly title?: unknown;
  readonly schema_version?: unknown;
}

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message, code: auth.code },
      { status: auth.status },
    );
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const documentType = body.document_type;
  if (
    documentType !== "contract" &&
    documentType !== "resume" &&
    documentType !== "invoice"
  ) {
    return badRequest(
      "document_type must be one of: contract, resume, invoice.",
    );
  }

  const outputFormat = body.output_format;
  if (outputFormat !== "pdf" && outputFormat !== "docx" && outputFormat !== "gdocs") {
    return badRequest("output_format must be one of: pdf, docx, gdocs.");
  }
  if (outputFormat !== "pdf") {
    return NextResponse.json(
      {
        error:
          "Only output_format=pdf is supported via MCP today. Use the web UI export for docx/gdocs.",
      },
      { status: 501 },
    );
  }

  const schema = getSchema(documentType);
  const parsed = schema.safeParse(body.structured_data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "structured_data did not pass schema validation.",
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 422 },
    );
  }
  const document = parsed.data as GlyphDocument;

  const canonical = canonicalize(document);
  if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
    return NextResponse.json(
      { error: "Canonical payload must be a JSON object." },
      { status: 500 },
    );
  }

  const { encrypted, iv, tag } = await encryptPayload(canonical);
  const signature = await signPayload(encrypted);

  const title =
    typeof body.title === "string" && body.title.length > 0
      ? body.title
      : `${documentType} (MCP)`;
  const schemaVersion =
    typeof (document as { schema_version?: unknown }).schema_version === "string"
      ? ((document as { schema_version: string }).schema_version)
      : "1.0";

  // Persist a finalized document row owned by the API key's user.
  const [row] = await db
    .insert(documents)
    .values({
      userId: auth.key.userId,
      title,
      documentType,
      documentTypeKey: documentType,
      schemaVersion,
      validatedJson: document as Record<string, unknown>,
      encryptedPayload: encrypted,
      payloadIv: iv,
      payloadTag: tag,
      payloadSignature: signature,
      isFinalized: true,
    })
    .returning({ id: documents.id });

  if (row === undefined) {
    return NextResponse.json(
      { error: "Failed to persist document." },
      { status: 500 },
    );
  }

  // Render PDF with embedded XMP sidecar, upload to private bucket, sign URL.
  const { generatePdf } = await import("@/lib/pdf");
  const pdfBytes = await generatePdf({
    document,
    xmp: {
      documentType,
      schemaVersion,
      encrypted,
      iv,
      tag,
      signature,
      timestamp: new Date().toISOString(),
    },
  });

  const supabase = getSupabaseServiceClient();
  const path = `${auth.key.userId}/${row.id}-${Date.now()}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from(EXPORTS_BUCKET)
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  const EXPIRES_IN = 60 * 60;
  const { data: signed, error: signErr } = await supabase.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(path, EXPIRES_IN);
  if (signErr || !signed) {
    return NextResponse.json(
      { error: `Could not sign URL: ${signErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  await db.insert(documentExports).values({
    documentId: row.id,
    userId: auth.key.userId,
    format: "pdf",
  });

  return NextResponse.json({
    downloadUrl: signed.signedUrl,
    expiresIn: EXPIRES_IN,
    documentId: row.id,
  });
}
