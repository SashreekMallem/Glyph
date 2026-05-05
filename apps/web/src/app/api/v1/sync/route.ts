/**
 * POST /api/v1/sync
 *
 * The unified self-healing-sync endpoint. Accepts a Glyph-stamped .docx
 * or .pdf, returns the structured payload that matches the document's
 * CURRENT visible text — re-extracting only the fields that drifted, if
 * any. Every Glyph surface (web editor, Word plugin, Google Docs plugin,
 * MCP server) calls this so the document and its embedded JSON stay in
 * lockstep regardless of where the file was edited.
 *
 * Auth: Bearer API key (same pattern as `/api/v1/extract`).
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { apiKeys, apiUsage } from "@/db/schema";
import { verifyApiKey } from "@glyph/crypto";
import { getExtractLimiter } from "@/lib/extract-ratelimit";
import {
  buildGlyphCustomXml,
  parseDocxBundle,
  parsePdfBundle,
  rebuildDocx,
  rebuildPdf,
} from "@/lib/sync/file-io";
import { buildGlyphXmpPacket } from "@/lib/pdf";
import { syncDocument } from "@/server/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY_PREFIX_LEN = 16;

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
  const started = Date.now();
  let keyPrefix: string | null = null;
  let documentType: string | null = null;

  try {
    // Auth
    const raw = parseBearer(req.headers.get("authorization"));
    if (!raw || raw.length < API_KEY_PREFIX_LEN) {
      return err(401, "unauthorized", "Missing or malformed Bearer token.");
    }
    keyPrefix = raw.slice(0, API_KEY_PREFIX_LEN);

    const [keyRecord] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, keyPrefix))
      .limit(1);
    if (!keyRecord) return err(401, "unauthorized", "Invalid API key.");
    const ok = await verifyApiKey(raw, keyRecord.keyHash);
    if (!ok) return err(401, "unauthorized", "Invalid API key.");
    if (!keyRecord.isActive) return err(403, "revoked", "API key has been revoked.");

    // Rate limit
    const limiter = getExtractLimiter();
    if (limiter) {
      const { success } = await limiter.limit(keyRecord.id);
      if (!success) {
        return err(429, "rate_limit_exceeded", "Daily request limit reached.");
      }
    }

    // Multipart parse
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return err(415, "unsupported_media_type", "Content-Type must be multipart/form-data.");
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return err(400, "bad_request", "Malformed multipart body.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return err(400, "bad_request", "multipart body must include a `file` field.");
    }

    const filename = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();
    const isDocx =
      filename.endsWith(".docx") ||
      fileType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const isPdf = filename.endsWith(".pdf") || fileType === "application/pdf";
    if (!isDocx && !isPdf) {
      return err(415, "unsupported_media_type", "Only .docx and .pdf are supported.");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const bundle = isDocx ? parseDocxBundle(bytes) : parsePdfBundle(bytes);

    documentType = bundle.embedded?.documentType ?? null;

    const result = await syncDocument({
      visibleText: bundle.visibleText,
      embedded: bundle.embedded,
      userId: keyRecord.userId,
    });

    // Best-effort usage bookkeeping.
    try {
      await db.insert(apiUsage).values({
        apiKeyId: keyRecord.id,
        documentType: null,
      });
      await db
        .update(apiKeys)
        .set({
          requestCount: sql`${apiKeys.requestCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(apiKeys.id, keyRecord.id));
    } catch {
      // never leak bookkeeping failures
    }

    if (result.status === "no_payload") {
      return NextResponse.json(
        {
          status: "no_payload",
          error: "Document does not contain a Glyph payload.",
        },
        { status: 200 },
      );
    }
    if (result.status === "decryption_failed") {
      return err(400, "decryption_failed", "Embedded payload could not be decrypted.");
    }

    // For `synced`: produce both the embedded fragment (for plugins that
    // can only swap a Custom XML Part / XMP packet — Word, Docs) AND the
    // whole rebuilt file (for the upload path — MCP, web download).
    let updatedFileB64: string | null = null;
    let embeddedXml: string | null = null;
    if (result.status === "synced" && result.newEmbedded) {
      if (isDocx) {
        embeddedXml = buildGlyphCustomXml(result.newEmbedded);
        updatedFileB64 = rebuildDocx(bytes, result.newEmbedded).toString("base64");
      } else {
        embeddedXml = buildGlyphXmpPacket({
          documentType: result.newEmbedded.documentType,
          schemaVersion: result.newEmbedded.schemaVersion,
          encrypted: result.newEmbedded.encrypted,
          iv: result.newEmbedded.iv,
          tag: result.newEmbedded.tag,
          signature: result.newEmbedded.signature,
          timestamp: result.newEmbedded.timestamp ?? new Date().toISOString(),
          compositionId: result.newEmbedded.compositionId ?? null,
          blockIds: result.newEmbedded.blockIds ?? null,
        });
        updatedFileB64 = (await rebuildPdf(bytes, result.newEmbedded)).toString(
          "base64",
        );
      }
    }

    return NextResponse.json(
      {
        status: result.status,
        data: result.data,
        document_type: result.documentType,
        schema_version: result.schemaVersion,
        signature_valid: result.signatureValid,
        drift: result.drift
          ? {
              changed: result.drift.changed,
              added: result.drift.added,
              removed: result.drift.removed,
            }
          : null,
        updated_file_b64: updatedFileB64,
        /**
         * Embedded XML fragment for plugins that can only swap a Custom
         * XML Part (.docx) or XMP packet (.pdf). For Word: replace the
         * Custom XML Part whose namespace is `https://glyph.dev/schemas/v1`.
         * For PDF: this is the full xpacket-wrapped XMP block.
         */
        embedded_xml: embeddedXml,
        format: isDocx ? "docx" : "pdf",
      },
      { status: 200 },
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[sync] error", {
      keyPrefix,
      documentType,
      durationMs: Date.now() - started,
      message: e instanceof Error ? e.message : String(e),
    });
    return err(500, "internal_error", "Request failed.");
  } finally {
    // eslint-disable-next-line no-console
    console.log("[sync] done", {
      keyPrefix,
      documentType,
      durationMs: Date.now() - started,
    });
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
