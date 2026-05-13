import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { ZodError } from "zod";

import { db } from "@/db";
import { apiKeys, apiUsage } from "@/db/schema";
import {
  decryptPayload,
  verifyApiKey,
  verifySignature,
  DecryptionError,
} from "@glyph/crypto";
import { type DocumentType } from "@glyph/schema-library";
import { getExtractLimiter } from "@/lib/extract-ratelimit";
import { extractXmp } from "@/lib/pdf";
import {
  extractOneShot,
  OneShotExtractError,
} from "@/lib/extract/oneshot";
import { SchemaNotFoundError } from "@/lib/extract/resolve-schema";
import { resolveSchema } from "@/server/documentRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY_PREFIX_LEN = 16;

interface JsonExtractInput {
  readonly encrypted: string;
  readonly iv: string;
  readonly tag: string;
  readonly signature: string;
  readonly document_type: string;
  readonly block_ids?: readonly string[];
}

interface RawTextExtractInput {
  readonly raw_text: string;
  readonly document_type: string;
  readonly block_ids?: readonly string[];
}

function isRawTextExtractInput(v: unknown): v is RawTextExtractInput {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.raw_text === "string" &&
    o.raw_text.length > 0 &&
    typeof o.document_type === "string" &&
    typeof (o as { encrypted?: unknown }).encrypted !== "string"
  );
}

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

function isJsonExtractInput(v: unknown): v is JsonExtractInput {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.encrypted === "string" &&
    typeof o.iv === "string" &&
    typeof o.tag === "string" &&
    typeof o.signature === "string" &&
    typeof o.document_type === "string"
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  let keyPrefix: string | null = null;
  let documentType: string | null = null;

  try {
    // 1. Bearer auth
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
    if (!keyRecord) {
      return err(401, "unauthorized", "Invalid API key.");
    }

    const ok = await verifyApiKey(raw, keyRecord.keyHash);
    if (!ok) {
      return err(401, "unauthorized", "Invalid API key.");
    }
    if (!keyRecord.isActive) {
      return err(403, "revoked", "API key has been revoked.");
    }

    // 2. Rate limit
    const limiter = getExtractLimiter();
    if (limiter) {
      const { success } = await limiter.limit(keyRecord.id);
      if (!success) {
        return err(429, "rate_limit_exceeded", "Daily request limit reached.");
      }
    }

    // 3. Parse body
    const contentType = req.headers.get("content-type") ?? "";
    let payload: JsonExtractInput;

    if (contentType.includes("multipart/form-data")) {
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
      const isPdf =
        filename.endsWith(".pdf") || fileType === "application/pdf";
      const isDocx =
        filename.endsWith(".docx") || 
        filename.endsWith(".doc") ||
        fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        fileType === "application/msword";
      const isMd =
        filename.endsWith(".md") || 
        filename.endsWith(".markdown") ||
        fileType === "text/markdown";

      if (isPdf) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const xmp = extractXmp(bytes);
        if (!xmp) {
          return err(
            400,
            "no_glyph_metadata",
            "PDF does not contain a Glyph XMP metadata packet.",
          );
        }
        payload = {
          encrypted: xmp.encrypted,
          iv: xmp.iv,
          tag: xmp.tag,
          signature: xmp.signature,
          document_type: xmp.documentType,
        };
      } else if (isMd) {
        const text = await file.text();
        const match = /---\s*\nglyph_id:.*?\nglyph_type: (.*?)\nglyph_encrypted: (.*?)\nglyph_iv: (.*?)\nglyph_tag: (.*?)\nglyph_signature: (.*?)\n---/s.exec(text);
        if (!match) {
          return err(400, "no_glyph_metadata", "Markdown file missing Glyph frontmatter.");
        }
        payload = {
          document_type: match[1]?.trim() || "",
          encrypted: match[2]?.trim() || "",
          iv: match[3]?.trim() || "",
          tag: match[4]?.trim() || "",
          signature: match[5]?.trim() || "",
        };
      } else if (isDocx) {
        const text = await file.text();
        const match = /<!-- GLYPH-METADATA\s*\n(.*?)\n-->/s.exec(text);
        if (!match) {
          return err(400, "no_glyph_metadata", "Word file missing Glyph metadata comment.");
        }
        try {
          const parsedMeta = JSON.parse(match[1] || "{}");
          payload = {
            encrypted: parsedMeta.encrypted,
            iv: parsedMeta.iv,
            tag: parsedMeta.tag,
            signature: parsedMeta.signature,
            document_type: parsedMeta.document_type,
          };
        } catch {
          return err(400, "bad_request", "Malformed Glyph metadata in Word file.");
        }
      } else {
        return err(
          415,
          "unsupported_media_type",
          "Only PDF, Word (.doc), and Markdown (.md) are supported for multipart uploads.",
        );
      }
    } else if (contentType.includes("application/json")) {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return err(400, "bad_request", "Body is not valid JSON.");
      }

      // New raw-text branch: invoke the LLM extraction pipeline.
      // Preserves backwards compat — only triggered when the body lacks the
      // encrypted-payload fields and includes `raw_text`.
      if (isRawTextExtractInput(body)) {
        documentType = body.document_type;
        try {
          const oneshot = await extractOneShot({
            text: body.raw_text,
            typeKey: documentType,
            userId: keyRecord.userId,
            db: db as never,
          });
          // Best-effort usage bookkeeping (mirrors the encrypted path).
          try {
            await db.insert(apiUsage).values({
              apiKeyId: keyRecord.id,
              documentType: documentType as DocumentType,
            });
            await db
              .update(apiKeys)
              .set({
                requestCount: sql`${apiKeys.requestCount} + 1`,
                lastUsedAt: new Date(),
              })
              .where(eq(apiKeys.id, keyRecord.id));
          } catch {
            // Never leak bookkeeping failures.
          }
          // Validate against the resolved schema for parity with the
          // encrypted path (the extract pipeline already conforms, but
          // we want the public response shape to be identical).
          let jsonSchema: unknown = null;
          try {
            const resolved = await resolveSchema({
              documentType,
              blockIds: body.block_ids,
              userId: keyRecord.userId,
            });
            jsonSchema = resolved.jsonSchema;
          } catch {
            jsonSchema = null;
          }
          return NextResponse.json(
            {
              document_type: documentType,
              schema_version:
                (oneshot.json as { schema_version?: string })
                  ?.schema_version ?? oneshot.schemaVersion,
              data: oneshot.json,
              json_schema: jsonSchema,
              signature_valid: false,
              extracted_at: new Date().toISOString(),
            },
            { status: 200 },
          );
        } catch (e) {
          if (e instanceof SchemaNotFoundError) {
            return err(
              400,
              "bad_request",
              `Unsupported document_type: ${documentType}`,
            );
          }
          if (e instanceof OneShotExtractError) {
            return err(502, "extract_failed", "Upstream extraction failed.");
          }
          throw e;
        }
      }

      if (!isJsonExtractInput(body)) {
        return err(
          400,
          "bad_request",
          "Body must contain encrypted, iv, tag, signature, document_type.",
        );
      }
      payload = body;
    } else {
      return err(
        415,
        "unsupported_media_type",
        "Content-Type must be application/json.",
      );
    }

    documentType = payload.document_type;

    // Resolve schema (blocks-first, then custom_type, then built-in).
    let resolvedSchema: Awaited<ReturnType<typeof resolveSchema>>;
    try {
      resolvedSchema = await resolveSchema({
        documentType,
        blockIds: payload.block_ids,
        userId: keyRecord.userId,
      });
    } catch {
      return err(400, "bad_request", `Unsupported document_type: ${documentType}`);
    }

    // 4. Verify signature (non-fatal; we record and return the result)
    let signatureValid = false;
    try {
      signatureValid = await verifySignature(payload.encrypted, payload.signature);
    } catch {
      signatureValid = false;
    }

    // 5. Decrypt
    let decrypted: object;
    try {
      decrypted = await decryptPayload(payload.encrypted, payload.iv, payload.tag);
    } catch (e) {
      if (e instanceof DecryptionError) {
        return err(400, "decryption_failed", "Payload could not be decrypted.");
      }
      throw e;
    }

    // 6. Validate schema
    const schema = resolvedSchema.zod;
    const parsed = schema.safeParse(decrypted);
    if (!parsed.success) {
      return err(400, "validation_failed", "Payload does not match schema.", {
        issues: parsed.error.issues,
      });
    }

    // 7. Record usage + update key counters (best-effort; fire async).
    try {
      await db.insert(apiUsage).values({
        apiKeyId: keyRecord.id,
        documentType: documentType as DocumentType,
      });
      await db
        .update(apiKeys)
        .set({
          requestCount: sql`${apiKeys.requestCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(apiKeys.id, keyRecord.id));
    } catch {
      // Usage bookkeeping failure must never leak to the caller.
    }

    // 8. Response
    const jsonSchema = resolvedSchema.jsonSchema;

    return NextResponse.json(
      {
        document_type: documentType,
        schema_version:
          (parsed.data as { schema_version?: string }).schema_version ?? "1.0",
        data: parsed.data,
        json_schema: jsonSchema,
        signature_valid: signatureValid,
        extracted_at: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (e) {
    // Generic catch — never leak stack traces.
    // Log minimal context (no raw payloads, no keys).
    const duration = Date.now() - started;
    const code =
      e instanceof ZodError ? "validation_failed" : "internal_error";
    // eslint-disable-next-line no-console
    console.error("[extract] error", {
      code,
      keyPrefix,
      documentType,
      durationMs: duration,
    });
    return err(code === "validation_failed" ? 400 : 500, code, "Request failed.");
  } finally {
    // Minimal outcome log.
    // eslint-disable-next-line no-console
    console.log("[extract] done", {
      keyPrefix,
      documentType,
      durationMs: Date.now() - started,
    });
  }
}

// Block other verbs explicitly.
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
